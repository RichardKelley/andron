import { TextLine } from './textline.js';
import { WordBox } from './wordbox.js';
import {
    DPI,
    PAGE_WIDTH,
    PAGE_HEIGHT,
    PAGE_MARGIN,
    PAGE_GAP,
    CAP_HEIGHT,
    BODY_HEIGHT,
    DESCENDER_HEIGHT
} from './constants.js';
import { MarginState } from './interfaces.js';
import { HistoryManager } from './history-manager.js';

export class CanvasManager {
    private currentDPI: number;
    private currentPageWidth: number;
    private currentPageHeight: number;
    private textLines: Map<number, TextLine[]>;
    private globalMargins: MarginState;
    private pageObserver: IntersectionObserver | null;
    private onMarginsUpdated: (() => void) | null = null;
    private historyManager: HistoryManager | null = null;

    constructor() {
        this.currentDPI = DPI;
        this.currentPageWidth = PAGE_WIDTH;
        this.currentPageHeight = PAGE_HEIGHT;
        this.textLines = new Map();
        this.globalMargins = this.initializeMargins();
        this.pageObserver = null;
        this.setupPageObserver();
        this.setupLineEventListeners();
        this.setupKeyboardEvents();
    }

    // Function to initialize margins based on current page dimensions
    private initializeMargins(): MarginState {
        const margin = this.currentDPI * 0.75; // 0.75 inch margins
        return {
            left: margin,
            right: this.currentPageWidth - margin,
            top: margin,
            bottom: this.currentPageHeight - margin
        };
    }

    // Function to update dimensions based on DPI
    updateDimensionsForDPI(dpi: number) {
        this.currentDPI = dpi;
        this.currentPageWidth = Math.round(8.5 * dpi);  // 8.5 inches
        this.currentPageHeight = Math.round(11 * dpi);  // 11 inches
        return {
            width: this.currentPageWidth,
            height: this.currentPageHeight
        };
    }

    // Function to update dimensions based on inches
    updateDimensionsForInches(widthInches: number, heightInches: number) {
        this.currentPageWidth = Math.round(widthInches * this.currentDPI);
        this.currentPageHeight = Math.round(heightInches * this.currentDPI);
        return {
            width: this.currentPageWidth,
            height: this.currentPageHeight
        };
    }

    // Function to clear the canvas
    clearCanvas(canvas: HTMLCanvasElement): void {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear the canvas
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, this.currentPageWidth, this.currentPageHeight);

        // Draw page border
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, this.currentPageWidth, this.currentPageHeight);
    }

    // Function to draw all lines on a canvas
    drawAllLines(canvas: HTMLCanvasElement): void {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const pageNumber = parseInt(canvas.parentElement?.dataset.pageNumber || '1');
        const lines = this.textLines.get(pageNumber) || [];
        
        lines.forEach(line => line.draw(ctx));
    }

    // Function to create a new page
    createPage(): { canvas: HTMLCanvasElement; marginLines: HTMLElement; wrapper: HTMLElement } {
        const pageWrapper = document.createElement('div');
        pageWrapper.className = 'canvas-container';
        
        const pageNumber = document.querySelectorAll('.canvas-container').length + 1;
        // Only add margin-top if this isn't the first page
        if (pageNumber > 1) {
            pageWrapper.style.marginTop = `${PAGE_GAP}px`;
        }
        pageWrapper.style.padding = `0 ${PAGE_MARGIN}px`;
        pageWrapper.setAttribute('tabindex', '-1');
        pageWrapper.style.outline = 'none';
        
        pageWrapper.dataset.pageNumber = pageNumber.toString();

        const newCanvas = document.createElement('canvas');
        newCanvas.width = this.currentPageWidth;
        newCanvas.height = this.currentPageHeight;
        newCanvas.style.display = 'block';
        newCanvas.style.margin = '0';
        newCanvas.style.padding = '0';
        newCanvas.style.position = 'relative';
        newCanvas.style.left = '0';
        newCanvas.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
        newCanvas.style.backgroundColor = 'white';
        newCanvas.style.zIndex = '0';

        // Create margin lines for the new page
        const marginLinesContainer = this.createMarginLines();

        // Add everything to the wrapper
        pageWrapper.appendChild(newCanvas);
        pageWrapper.appendChild(marginLinesContainer);

        // Add the wrapper to the container
        const mainContent = document.querySelector('#main-content');
        if (mainContent) {
            mainContent.appendChild(pageWrapper);
        }

        // Update thumbnails
        this.updateThumbnails();

        // Observe the new page
        if (this.pageObserver) {
            this.pageObserver.observe(pageWrapper);
        }

        this.clearCanvas(newCanvas);
        return { canvas: newCanvas, marginLines: marginLinesContainer, wrapper: pageWrapper };
    }

    // Function to create margin lines for a page
    private createMarginLines(): HTMLElement {
        const marginLinesContainer = document.createElement('div');
        marginLinesContainer.className = 'margin-lines-container';
        marginLinesContainer.style.left = '0px';

        // Get checkbox states
        const marginTopCheck = document.getElementById('margin-top-check') as HTMLInputElement;
        const marginRightCheck = document.getElementById('margin-right-check') as HTMLInputElement;
        const marginBottomCheck = document.getElementById('margin-bottom-check') as HTMLInputElement;
        const marginLeftCheck = document.getElementById('margin-left-check') as HTMLInputElement;

        // Create vertical margin lines
        [0, 1].forEach((index) => {
            const isLeft = index === 0;
            const leftPos = isLeft ? this.globalMargins.left : this.globalMargins.right;
            const isChecked = isLeft ? marginLeftCheck?.checked : marginRightCheck?.checked;

            if (isChecked) {
                // Create a container for all three lines
                const lineContainer = document.createElement('div');
                lineContainer.style.position = 'absolute';
                lineContainer.style.left = `${leftPos - PAGE_MARGIN}px`;
                lineContainer.style.top = '0px';
                lineContainer.style.width = '1px';  // Single pixel for precise positioning
                lineContainer.style.height = `${this.currentPageHeight}px`;
                lineContainer.style.cursor = 'col-resize';
                lineContainer.style.pointerEvents = 'auto';
                this.addMarginDragHandlers(lineContainer);

                // Top dotted extension
                const topLine = document.createElement('div');
                topLine.style.position = 'absolute';
                topLine.style.left = '0px';
                topLine.style.top = '0px';
                topLine.style.width = '0';
                topLine.style.height = `${this.globalMargins.top}px`;
                topLine.style.borderLeft = '2px dotted #999';
                topLine.style.pointerEvents = 'none';
                lineContainer.appendChild(topLine);

                // Middle solid line
                const middleLine = document.createElement('div');
                middleLine.style.position = 'absolute';
                middleLine.style.left = '0px';
                middleLine.style.top = `${this.globalMargins.top}px`;
                middleLine.style.width = '0';
                middleLine.style.height = `${this.globalMargins.bottom - this.globalMargins.top}px`;
                middleLine.style.borderLeft = '2px solid black';
                middleLine.style.pointerEvents = 'none';
                lineContainer.appendChild(middleLine);

                // Bottom dotted extension
                const bottomLine = document.createElement('div');
                bottomLine.style.position = 'absolute';
                bottomLine.style.left = '0px';
                bottomLine.style.top = `${this.globalMargins.bottom}px`;
                bottomLine.style.width = '0';
                bottomLine.style.height = `${this.currentPageHeight - this.globalMargins.bottom}px`;
                bottomLine.style.borderLeft = '2px dotted #999';
                bottomLine.style.pointerEvents = 'none';
                lineContainer.appendChild(bottomLine);

                marginLinesContainer.appendChild(lineContainer);
            } else {
                // Single dotted line for unchecked margins
                const line = document.createElement('div');
                line.style.position = 'absolute';
                line.style.left = `${leftPos - PAGE_MARGIN}px`;
                line.style.top = '0px';
                line.style.width = '1px';  // Single pixel for precise positioning
                line.style.height = `${this.currentPageHeight}px`;
                line.style.borderLeft = '2px dotted #999';
                line.style.cursor = 'col-resize';
                line.style.pointerEvents = 'auto';
                this.addMarginDragHandlers(line);
                marginLinesContainer.appendChild(line);
            }
        });

        // Add horizontal margin lines
        [0, 1].forEach((index) => {
            const isTop = index === 0;
            const topPos = isTop ? this.globalMargins.top : this.globalMargins.bottom;
            const isChecked = isTop ? marginTopCheck?.checked : marginBottomCheck?.checked;

            if (isChecked) {
                // Create a container for all three lines
                const lineContainer = document.createElement('div');
                lineContainer.style.position = 'absolute';
                lineContainer.style.left = '0px';
                lineContainer.style.top = `${topPos}px`;
                lineContainer.style.width = `${this.currentPageWidth}px`;
                lineContainer.style.height = '1px';  // Single pixel for precise positioning
                lineContainer.style.cursor = 'row-resize';
                lineContainer.style.pointerEvents = 'auto';
                this.addMarginDragHandlers(lineContainer);

                // Left dotted extension
                const leftLine = document.createElement('div');
                leftLine.style.position = 'absolute';
                leftLine.style.left = '0px';
                leftLine.style.top = '0px';
                leftLine.style.width = `${this.globalMargins.left - PAGE_MARGIN}px`;
                leftLine.style.height = '0';
                leftLine.style.borderTop = '2px dotted #999';
                leftLine.style.pointerEvents = 'none';
                lineContainer.appendChild(leftLine);

                // Middle solid line
                const middleLine = document.createElement('div');
                middleLine.style.position = 'absolute';
                middleLine.style.left = `${this.globalMargins.left - PAGE_MARGIN}px`;
                middleLine.style.top = '0px';
                middleLine.style.width = `${this.globalMargins.right - this.globalMargins.left}px`;
                middleLine.style.height = '0';
                middleLine.style.borderTop = '2px solid black';
                middleLine.style.pointerEvents = 'none';
                lineContainer.appendChild(middleLine);

                // Right dotted extension
                const rightLine = document.createElement('div');
                rightLine.style.position = 'absolute';
                rightLine.style.left = `${this.globalMargins.right - PAGE_MARGIN}px`;
                rightLine.style.top = '0px';
                rightLine.style.width = `${this.currentPageWidth - (this.globalMargins.right - PAGE_MARGIN)}px`;
                rightLine.style.height = '0';
                rightLine.style.borderTop = '2px dotted #999';
                rightLine.style.pointerEvents = 'none';
                lineContainer.appendChild(rightLine);

                marginLinesContainer.appendChild(lineContainer);
            } else {
                // Single dotted line for unchecked margins
                const line = document.createElement('div');
                line.style.position = 'absolute';
                line.style.left = '0px';
                line.style.top = `${topPos}px`;
                line.style.width = `${this.currentPageWidth}px`;
                line.style.height = '1px';  // Single pixel for precise positioning
                line.style.borderTop = '2px dotted #999';
                line.style.cursor = 'row-resize';
                line.style.pointerEvents = 'auto';
                this.addMarginDragHandlers(line);
                marginLinesContainer.appendChild(line);
            }
        });

        return marginLinesContainer;
    }

    // Function to add margin line drag handlers
    private addMarginDragHandlers(line: HTMLElement) {
        let isDraggingMargin = false;
        let initialDragPos = 0;
        let lastPos = 0;

        const startDrag = (e: MouseEvent) => {
            isDraggingMargin = true;
            initialDragPos = line.style.cursor === 'col-resize' ? e.clientX : e.clientY;
            
            // Get the current position from the line's position
            lastPos = line.style.cursor === 'col-resize' ? 
                parseInt(line.style.left) + PAGE_MARGIN :
                parseInt(line.style.top);
            
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            e.stopPropagation();
            e.preventDefault();
        };

        const handleMouseMove = (e: MouseEvent) => {
            if (!isDraggingMargin) return;

            e.preventDefault();
            const isVertical = line.style.cursor === 'col-resize';
            
            if (isVertical) {
                const delta = e.clientX - initialDragPos;
                const newPos = lastPos + delta;
                
                if (newPos >= 0 && newPos <= this.currentPageWidth) {
                    if (newPos <= this.currentPageWidth / 2) {
                        this.globalMargins.left = newPos;
                    } else {
                        this.globalMargins.right = newPos;
                    }
                    
                    // Update tracking variables for next movement
                    initialDragPos = e.clientX;
                    lastPos = newPos;
                    
                    // Update all margins immediately during dragging
                    this.updateAllMargins();
                }
            } else {
                const delta = e.clientY - initialDragPos;
                const newPos = lastPos + delta;
                
                if (newPos >= 0 && newPos <= this.currentPageHeight) {
                    if (newPos <= this.currentPageHeight / 2) {
                        this.globalMargins.top = newPos;
                    } else {
                        this.globalMargins.bottom = newPos;
                    }
                    
                    // Update tracking variables for next movement
                    initialDragPos = e.clientY;
                    lastPos = newPos;
                    
                    // Update all margins immediately during dragging
                    this.updateAllMargins();
                }
            }
        };

        const handleMouseUp = () => {
            if (isDraggingMargin) {
                isDraggingMargin = false;
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            }
        };

        // Add mousedown listener directly to the line element
        line.addEventListener('mousedown', startDrag);
    }

    // Function to update all margin lines
    updateAllMargins() {
        // Remove all existing margin lines and recreate them
        document.querySelectorAll('.margin-lines-container').forEach(container => {
            const parent = container.parentElement;
            if (parent) {
                const newContainer = this.createMarginLines();
                parent.replaceChild(newContainer, container);
            }
        });

        // Redraw all lines on all canvases
        document.querySelectorAll('.canvas-container canvas').forEach(canvas => {
            this.clearCanvas(canvas as HTMLCanvasElement);
            this.drawAllLines(canvas as HTMLCanvasElement);
        });

        // Update margin inputs with new values
        this.updateMarginInputs();
    }

    // Function to add a new line to a page
    addTextLine(pageNumber: number, yPosition: number): TextLine {
        const lines = this.textLines.get(pageNumber) || [];
        const newLine = new TextLine(pageNumber, yPosition, this);
        if (this.historyManager) {
            newLine.setHistoryManager(this.historyManager);
        }
        lines.push(newLine);
        this.textLines.set(pageNumber, lines);

        // Draw the new line
        const canvas = document.querySelector(`.canvas-container[data-page-number="${pageNumber}"] canvas`) as HTMLCanvasElement;
        if (canvas) {
            this.clearCanvas(canvas);
            this.drawAllLines(canvas);
        }

        return newLine;
    }

    // Function to create a thumbnail from a canvas
    private createThumbnail(sourceCanvas: HTMLCanvasElement, pageNumber: number): HTMLDivElement {
        const thumbnailContainer = document.createElement('div');
        thumbnailContainer.className = 'page-thumbnail';
        thumbnailContainer.dataset.pageNumber = pageNumber.toString();

        const thumbnailCanvas = document.createElement('canvas');
        thumbnailCanvas.width = sourceCanvas.width;
        thumbnailCanvas.height = sourceCanvas.height;

        const ctx = thumbnailCanvas.getContext('2d');
        if (ctx) {
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, thumbnailCanvas.width, thumbnailCanvas.height);
            ctx.drawImage(sourceCanvas, 0, 0);
        }

        const pageNumberLabel = document.createElement('div');
        pageNumberLabel.className = 'page-number';
        pageNumberLabel.textContent = `Page ${pageNumber}`;

        thumbnailContainer.appendChild(thumbnailCanvas);
        thumbnailContainer.appendChild(pageNumberLabel);

        // Add context menu handler
        thumbnailContainer.addEventListener('contextmenu', (e) => {
            e.preventDefault();

            // Remove any existing context menus
            document.querySelectorAll('.context-menu').forEach(menu => menu.remove());

            // Create context menu
            const contextMenu = document.createElement('div');
            contextMenu.className = 'context-menu';
            contextMenu.style.position = 'fixed';
            contextMenu.style.left = `${e.clientX}px`;
            contextMenu.style.top = `${e.clientY}px`;

            // Create delete option
            const deleteOption = document.createElement('div');
            deleteOption.className = 'context-menu-item';
            deleteOption.textContent = 'Delete Page';
            deleteOption.addEventListener('click', () => {
                this.deletePage(pageNumber);
                contextMenu.remove();
            });

            contextMenu.appendChild(deleteOption);
            document.body.appendChild(contextMenu);

            // Close context menu when clicking outside
            const closeContextMenu = (e: MouseEvent) => {
                if (!contextMenu.contains(e.target as Node)) {
                    contextMenu.remove();
                    document.removeEventListener('click', closeContextMenu);
                }
            };
            document.addEventListener('click', closeContextMenu);
        });

        // Add click handler to navigate to the page
        thumbnailContainer.addEventListener('click', () => {
            // Remove active class from all thumbnails
            document.querySelectorAll('.page-thumbnail').forEach(thumb => {
                thumb.classList.remove('active');
            });
            // Add active class to clicked thumbnail
            thumbnailContainer.classList.add('active');
            
            // Find and scroll to the corresponding page
            const mainContent = document.querySelector('#main-content');
            const pages = mainContent?.querySelectorAll('.canvas-container');
            const targetPage = Array.from(pages || []).find(page => 
                (page as HTMLElement).dataset.pageNumber === pageNumber.toString()
            );

            if (targetPage) {
                targetPage.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });

        return thumbnailContainer;
    }

    // Function to update thumbnails
    updateThumbnails() {
        const thumbnailsContainer = document.getElementById('page-thumbnails');
        if (!thumbnailsContainer) return;

        // Clear existing thumbnails
        thumbnailsContainer.innerHTML = '';

        // Get all page canvases
        const pages = document.querySelectorAll('.canvas-container canvas');
        pages.forEach((canvas, index) => {
            const thumbnail = this.createThumbnail(canvas as HTMLCanvasElement, index + 1);
            thumbnailsContainer.appendChild(thumbnail);
        });
    }

    // Function to setup page observer
    private setupPageObserver() {
        // Disconnect existing observer if it exists
        if (this.pageObserver) {
            this.pageObserver.disconnect();
        }

        this.pageObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const pageNumber = (entry.target as HTMLElement).dataset.pageNumber;
                    // Update thumbnail highlighting
                    document.querySelectorAll('.page-thumbnail').forEach(thumb => {
                        thumb.classList.toggle('active', 
                            (thumb as HTMLElement).dataset.pageNumber === pageNumber
                        );
                    });
                }
            });
        }, {
            root: document.querySelector('#main-content'),
            threshold: 0.5  // Trigger when 50% of the page is visible
        });

        // Observe all existing pages
        document.querySelectorAll('.canvas-container').forEach(page => {
            if (this.pageObserver) {
                this.pageObserver.observe(page);
            }
        });
    }

    // Add line drag event listeners
    private setupLineEventListeners() {
        let activeDragLine: TextLine | null = null;

        document.addEventListener('mousedown', (e) => {
            const target = e.target as HTMLElement;
            const canvas = target.closest('canvas') as HTMLCanvasElement;
            if (!canvas) return;

            const rect = canvas.getBoundingClientRect();
            const scaleY = canvas.height / rect.height;
            const mouseY = (e.clientY - rect.top) * scaleY;

            const pageNumber = parseInt(canvas.parentElement?.dataset.pageNumber || '1');
            const lines = this.textLines.get(pageNumber) || [];

            // Track if we clicked on any line
            let clickedOnLine = false;

            // Find the line being clicked
            for (const line of lines) {
                if (line.isNearLine(0, mouseY)) {
                    clickedOnLine = true;
                    // If just clicking (not dragging), toggle selection
                    if (!activeDragLine) {
                        line.setSelected(!line.isSelected());
                    }
                    activeDragLine = line;
                    line.startDrag(e.clientY);
                    break;
                }
            }

            // If we clicked on the canvas but not on any line, deselect all lines
            if (!clickedOnLine) {
                lines.forEach(line => {
                    if (line.isSelected()) {
                        line.setSelected(false);
                    }
                });
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (activeDragLine) {
                const canvas = document.querySelector(`.canvas-container[data-page-number="${activeDragLine.getPageNumber()}"] canvas`) as HTMLCanvasElement;
                if (canvas) {
                    activeDragLine.drag(e.clientY, canvas);
                }
            }
        });

        document.addEventListener('mouseup', () => {
            if (activeDragLine) {
                activeDragLine.stopDrag();
                activeDragLine = null;
            }
        });
    }

    // Add setter for margins update callback
    setOnMarginsUpdated(callback: () => void) {
        this.onMarginsUpdated = callback;
    }

    // Function to set global margins
    setGlobalMargins(margins: MarginState) {
        this.globalMargins = margins;
    }

    // Function to update margins from input values (in inches)
    updateMarginsFromInputs(inputs: { top: string; right: string; bottom: string; left: string }) {
        
        // Convert inches to pixels for each margin
        const topMargin = Math.max(0, Math.min(5, parseFloat(inputs.top) || 0)) * this.currentDPI;
        const rightMargin = Math.max(0, Math.min(5, parseFloat(inputs.right) || 0)) * this.currentDPI;
        const bottomMargin = Math.max(0, Math.min(5, parseFloat(inputs.bottom) || 0)) * this.currentDPI;
        const leftMargin = Math.max(0, Math.min(5, parseFloat(inputs.left) || 0)) * this.currentDPI;

        // Set the new margins
        this.globalMargins = {
            top: topMargin,
            right: this.currentPageWidth - rightMargin,
            bottom: this.currentPageHeight - bottomMargin,
            left: leftMargin
        };

        this.updateAllMargins();
    }

    // Function to validate and format a margin value
    formatMarginValue(value: string, defaultValue: string = '0.75'): string {
        const numValue = parseFloat(value);
        if (value === '' || value === '.' || isNaN(numValue)) {
            return defaultValue;
        }
        const clampedValue = Math.max(0, Math.min(5, numValue));
        return clampedValue.toFixed(2);
    }

    // Function to get margin values in inches
    getMarginsInInches(): { top: string; right: string; bottom: string; left: string } {
        return {
            top: (this.globalMargins.top / this.currentDPI).toFixed(2),
            right: ((this.currentPageWidth - this.globalMargins.right) / this.currentDPI).toFixed(2),
            bottom: ((this.currentPageHeight - this.globalMargins.bottom) / this.currentDPI).toFixed(2),
            left: (this.globalMargins.left / this.currentDPI).toFixed(2)
        };
    }

    // Function to update margin input elements with current values
    updateMarginInputs() {
        const margins = this.getMarginsInInches();
        const inputs = {
            top: document.getElementById('margin-top') as HTMLInputElement,
            right: document.getElementById('margin-right') as HTMLInputElement,
            bottom: document.getElementById('margin-bottom') as HTMLInputElement,
            left: document.getElementById('margin-left') as HTMLInputElement
        };

        if (inputs.top) inputs.top.value = margins.top;
        if (inputs.right) inputs.right.value = margins.right;
        if (inputs.bottom) inputs.bottom.value = margins.bottom;
        if (inputs.left) inputs.left.value = margins.left;
    }

    // Function to delete a line from a page
    deleteLine(line: TextLine): void {
        const pageNumber = line.getPageNumber();
        const lines = this.textLines.get(pageNumber) || [];
        const index = lines.indexOf(line);
        
        if (index !== -1) {
            lines.splice(index, 1);
            this.textLines.set(pageNumber, lines);

            // Redraw the canvas
            const canvas = document.querySelector(`.canvas-container[data-page-number="${pageNumber}"] canvas`) as HTMLCanvasElement;
            if (canvas) {
                this.clearCanvas(canvas);
                this.drawAllLines(canvas);
            }
        }
    }

    // Function to delete a page
    deletePage(pageNumber: number): void {
        // Find and remove the page element
        const pageElement = document.querySelector(`.canvas-container[data-page-number="${pageNumber}"]`);
        if (!pageElement) return;

        // Remove the page's text lines from the map
        this.textLines.delete(pageNumber);

        // Remove the page element
        pageElement.remove();

        // Renumber remaining pages
        const pages = document.querySelectorAll('.canvas-container');
        pages.forEach((page, index) => {
            const pageEl = page as HTMLElement;
            pageEl.dataset.pageNumber = (index + 1).toString();
            
            // Update page number boxes if they exist
            const pageNumberBox = pageEl.querySelector('.page-number-box .wordbox-rect');
            if (pageNumberBox) {
                pageNumberBox.textContent = (index + 1).toString();
            }
        });

        // Update thumbnails
        this.updateThumbnails();
    }

    // Getters for private properties
    getCurrentDPI(): number {
        return this.currentDPI;
    }

    getCurrentPageWidth(): number {
        return this.currentPageWidth;
    }

    getCurrentPageHeight(): number {
        return this.currentPageHeight;
    }

    getGlobalMargins(): MarginState {
        return { ...this.globalMargins };
    }

    getTextLines(): Map<number, TextLine[]> {
        return this.textLines;
    }

    setHistoryManager(historyManager: HistoryManager): void {
        this.historyManager = historyManager;
    }
    
    // Setup keyboard event listeners for line operations
    private setupKeyboardEvents(): void {
        document.addEventListener('keydown', (e) => {
            // Only handle key events when we're not in an input field
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }
            
            // Also check if there's any active input field in a wordbox
            const activeInput = document.querySelector('.wordbox-rect input');
            if (activeInput) {
                return;
            }
            
            // Handle 'x' key to delete selected line
            if (e.key === 'x') {
                // Find the selected line on any page
                let selectedLine: TextLine | null = null;
                let selectedPageNumber: number = 0;
                
                // Search through all pages and lines
                for (const [pageNum, lines] of this.textLines.entries()) {
                    for (const line of lines) {
                        if (line.isSelected()) {
                            selectedLine = line;
                            selectedPageNumber = pageNum;
                            break;
                        }
                    }
                    if (selectedLine) break;
                }
                
                // If a line is selected, delete it
                if (selectedLine) {
                    // Record the delete operation if we have a history manager
                    if (this.historyManager) {
                        this.historyManager.addOperation(
                            this.historyManager.createDeleteLineOperation(selectedLine, selectedPageNumber)
                        );
                    }
                    
                    // Delete the line
                    this.deleteLine(selectedLine);
                }
            }
        });
    }
} 