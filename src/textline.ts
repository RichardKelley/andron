// TextLine class to manage word boxes
import { WordBox, getAllConnectedBoxes, updateChildBoxPosition } from './wordbox.js';
import { BODY_HEIGHT, CAP_HEIGHT, DESCENDER_HEIGHT, PAGE_MARGIN, ASCENDER_HEIGHT } from './constants.js';
import { CanvasManager } from './canvas-manager.js';
import { HistoryManager } from './history-manager.js';

export class TextLine {
    private wordBoxes: WordBox[] = [];
    private pageNumber: number;
    private yPosition: number;
    private bodyHeight: number;
    private isDragging: boolean = false;
    private dragStartY: number = 0;
    private canvasManager: CanvasManager;
    private selected: boolean = false;
    private stableId: string;
    private initialY: number = 0;
    private historyManager: HistoryManager | null = null;
    private preventSnap: boolean = false;

    constructor(pageNumber: number, yPosition: number, canvasManager: CanvasManager, bodyHeight: number = BODY_HEIGHT) {
        this.pageNumber = pageNumber;
        this.yPosition = yPosition;
        this.bodyHeight = bodyHeight;
        this.canvasManager = canvasManager;
        this.stableId = Math.random().toString(36).substr(2, 9);
    }

    // Draw this line on the specified canvas context
    draw(ctx: CanvasRenderingContext2D): void {
        const margins = this.canvasManager.getGlobalMargins();
        const startX = margins.left - PAGE_MARGIN;
        const endX = margins.right - PAGE_MARGIN;
        
        // Set color based on selection state and visibility
        const lineColor = WordBox.linesAreVisible ? 
            (this.selected ? '#4a9eff' : '#000000') : 
            'transparent';
        
        // Draw baseline (solid)
        ctx.beginPath();
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1;
        ctx.moveTo(startX, this.yPosition);
        ctx.lineTo(endX, this.yPosition);
        ctx.stroke();

        // Draw cap height line (solid)
        ctx.beginPath();
        ctx.moveTo(startX, this.yPosition - CAP_HEIGHT);
        ctx.lineTo(endX, this.yPosition - CAP_HEIGHT);
        ctx.stroke();

        // Add a slightly thicker hit area for dragging (always transparent)
        ctx.beginPath();
        ctx.strokeStyle = 'transparent';  // Make it invisible but clickable
        ctx.lineWidth = 10;  // Wider hit area
        ctx.moveTo(startX, this.yPosition);
        ctx.lineTo(endX, this.yPosition);
        ctx.stroke();
    }

    // Start dragging the line
    startDrag(clientY: number): void {
        this.isDragging = true;
        this.dragStartY = clientY;
        this.initialY = this.yPosition; // Store initial position
        this.setSelected(true);
    }

    // Continue dragging the line
    drag(clientY: number, canvas: HTMLCanvasElement): void {
        if (!this.isDragging) return;

        const rect = canvas.getBoundingClientRect();
        const scaleY = canvas.height / rect.height;
        const deltaY = (clientY - this.dragStartY) * scaleY;
        
        // Calculate new position
        const newY = this.yPosition + deltaY;
        
        // Check if the new position is within margins
        const margins = this.canvasManager.getGlobalMargins();
        if (newY >= margins.top + CAP_HEIGHT && 
            newY + DESCENDER_HEIGHT <= margins.bottom) {
            this.setYPosition(newY);
            this.dragStartY = clientY;
        }
    }

    // Stop dragging the line
    stopDrag(): void {
        if (this.isDragging && this.historyManager && this.initialY !== this.yPosition) {
            // Get the page number from the line ID
            const pageNumber = parseInt(this.getId().split('-')[1]);
            
            // Record the move operation
            this.historyManager.addOperation(
                this.historyManager.createMoveLineOperation(
                    this,
                    this.initialY,
                    this.yPosition,
                    pageNumber
                )
            );
        }
        this.isDragging = false;
    }

    // Get whether the line is selected
    isSelected(): boolean {
        return this.selected;
    }

    // Set the selection state of the line
    setSelected(selected: boolean): void {
        if (this.selected === selected) return; // Only update if state actually changes
        
        this.selected = selected;
        
        // If this line is being selected, deselect all other lines on the page
        if (selected) {
            const lines = this.canvasManager.getTextLines().get(this.pageNumber) || [];
            lines.forEach(line => {
                if (line !== this && line.isSelected()) {
                    line.setSelected(false);
                }
            });
        }
        
        // Redraw the canvas to reflect the selection change
        const canvas = document.querySelector(`.canvas-container[data-page-number="${this.pageNumber}"] canvas`) as HTMLCanvasElement;
        if (canvas) {
            this.canvasManager.clearCanvas(canvas);
            this.canvasManager.drawAllLines(canvas);
        }
    }

    // Check if a point is near this line
    isNearLine(x: number, y: number): boolean {
        // Get the margins to determine the line's horizontal span
        const margins = this.canvasManager.getGlobalMargins();
        const startX = margins.left - PAGE_MARGIN;
        const endX = margins.right - PAGE_MARGIN;

        // Check if x is within the line's horizontal span
        // We ignore the x coordinate when it's 0 (meaning we don't care about horizontal position)
        const isWithinHorizontalSpan = x === 0 || (x >= startX && x <= endX);

        // Check if y is within SNAP_DISTANCE pixels of the baseline
        const SNAP_DISTANCE = 20;
        const distance = Math.abs(y - this.yPosition);
        
        return isWithinHorizontalSpan && distance <= SNAP_DISTANCE;
    }

    // Get whether the line is being dragged
    isDraggingLine(): boolean {
        return this.isDragging;
    }

    // Add method to control snapping
    setPreventSnap(prevent: boolean): void {
        this.preventSnap = prevent;
    }

    // Update addWordBox to respect the preventSnap flag
    addWordBox(wordBox: WordBox): void {
        // Get all connected boxes
        const connectedBoxes = getAllConnectedBoxes(wordBox);
        
        // Add all boxes to this line
        connectedBoxes.forEach(box => {
            if (!this.wordBoxes.includes(box)) {
                this.wordBoxes.push(box);
                box.setLineId(this.getId());
            }
        });

        // Only update positions if snapping is not prevented
        if (!this.preventSnap) {
            this.updateWordBoxPosition(wordBox);
        }
    }

    // Remove a word box from this line
    removeWordBox(wordBox: WordBox): void {
        // Get all connected boxes
        const connectedBoxes = getAllConnectedBoxes(wordBox);
        
        // Remove all boxes from this line
        connectedBoxes.forEach(box => {
            const index = this.wordBoxes.indexOf(box);
            if (index !== -1) {
                this.wordBoxes.splice(index, 1);
                box.setLineId(undefined);
            }
        });
    }

    // Update the vertical position of a word box to align with this line
    private updateWordBoxPosition(wordBox: WordBox): void {
        // Get the canvas for this page
        const canvas = document.querySelector(`.canvas-container[data-page-number="${this.pageNumber}"] canvas`) as HTMLCanvasElement;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const containerRect = canvas.parentElement?.getBoundingClientRect();
        if (!containerRect) return;

        const scaleY = canvas.height / rect.height;
        
        // Calculate the position in screen coordinates
        const screenY = (this.yPosition / scaleY) - CAP_HEIGHT;
        
        // Set the position
        const element = wordBox.getElement();
        element.style.top = `${screenY}px`;

        // Keep the horizontal position unchanged
        const currentLeft = parseInt(element.style.left);
        if (!isNaN(currentLeft)) {
            element.style.left = `${currentLeft}px`;
        }

        // Get all connected boxes and update their positions
        const connectedBoxes = getAllConnectedBoxes(wordBox);
        connectedBoxes.forEach(box => {
            if (box !== wordBox) { // Skip the original box as it's already positioned
                // If this is a child box, update its position relative to its parent
                const parentId = box.getParentId();
                if (parentId) {
                    const parentBox = WordBox.fromElement(document.getElementById(parentId));
                    if (parentBox) {
                        updateChildBoxPosition(parentBox);
                    }
                }
            }
        });
    }

    // Get all word boxes in this line
    getWordBoxes(): WordBox[] {
        return [...this.wordBoxes];
    }

    // Get the unique identifier for this line
    getId(): string {
        // Use a stable ID that doesn't change with position
        return `line-${this.pageNumber}-${this.stableId}`;
    }

    // Get the vertical position of this line
    getYPosition(): number {
        return this.yPosition;
    }

    // Set the vertical position of this line and update all word boxes
    setYPosition(yPosition: number): void {
        this.yPosition = yPosition;
        
        // Get all root parent boxes (boxes without parents)
        const rootBoxes = this.wordBoxes.filter(box => !box.getParentId());
        
        // Update only root boxes, they will handle their children
        rootBoxes.forEach(wordBox => {
            if (wordBox.getLineId() === this.getId()) {
                const element = wordBox.getElement();
                const canvas = element.closest('.canvas-container')?.querySelector('canvas');
                if (!canvas) return;

                const rect = canvas.getBoundingClientRect();
                const containerRect = element.closest('.canvas-container')?.getBoundingClientRect();
                if (!containerRect) return;
                
                const scaleY = canvas.height / rect.height;
                const wordboxRect = element.getBoundingClientRect();

                // Convert line position to screen coordinates
                const lineScreenY = this.yPosition / scaleY;
                // Calculate center by subtracting CAP_HEIGHT
                const lineCenter = lineScreenY - CAP_HEIGHT;
                
                // Calculate snap position relative to the container
                const snapY = lineCenter - (wordboxRect.height / 2) + ASCENDER_HEIGHT - 16;
                element.style.top = `${snapY}px`;

                // Update child positions, passing the parent's current left position to maintain horizontal alignment
                const parentLeft = parseFloat(element.style.left);
                updateChildBoxPosition(wordBox, parentLeft);
            }
        });

        // Redraw the line on the canvas
        const canvas = document.querySelector(`.canvas-container[data-page-number="${this.pageNumber}"] canvas`) as HTMLCanvasElement;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                this.canvasManager.clearCanvas(canvas);
                this.canvasManager.drawAllLines(canvas);
            }
        }
    }

    // Get the body height of this line
    getBodyHeight(): number {
        return this.bodyHeight;
    }

    // Get the page number this line belongs to
    getPageNumber(): number {
        return this.pageNumber;
    }

    // Get whether the line is empty (has no word boxes)
    isEmpty(): boolean {
        return this.wordBoxes.length === 0;
    }

    setHistoryManager(historyManager: HistoryManager): void {
        this.historyManager = historyManager;
    }
}