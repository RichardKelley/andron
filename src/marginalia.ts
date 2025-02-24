import { CAP_HEIGHT } from './constants.js';
import { HistoryManager } from './history-manager.js';

declare global {
    interface Window {
        historyManager: HistoryManager;
    }
}

export class Marginalia {
    private static instances: Map<string, Marginalia> = new Map();
    private id: string;
    private element: HTMLElement;
    private textArea: HTMLTextAreaElement = document.createElement('textarea');
    private resizer: HTMLElement = document.createElement('div');
    private isDragging: boolean = false;
    private isResizing: boolean = false;
    private dragStartX: number = 0;
    private dragStartY: number = 0;
    private initialX: number = 0;
    private initialY: number = 0;
    private initialWidth: number = 0;
    private initialHeight: number = 0;

    constructor(x: number, y: number) {
        this.id = `marginalia-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.element = this.createHTMLElement(x, y);
        Marginalia.instances.set(this.id, this);
        this.setupEventListeners();
    }

    private createHTMLElement(x: number, y: number): HTMLElement {
        // Create main container
        const container = document.createElement('div');
        container.id = this.id;
        container.className = 'marginalia';
        container.style.position = 'absolute';
        container.style.left = `${x}px`;
        container.style.top = `${y}px`;
        container.style.minWidth = '150px';
        container.style.minHeight = '100px';
        container.style.width = '200px';
        container.style.height = '150px';
        container.style.backgroundColor = 'white';
        container.style.padding = '8px';
        container.style.cursor = 'move';
        container.style.zIndex = '100';

        // Create textarea with explicit focus handling
        this.textArea.style.width = '100%';
        this.textArea.style.height = 'calc(100% - 16px)';
        this.textArea.style.border = 'none';
        this.textArea.style.resize = 'none';
        this.textArea.style.outline = 'none';
        this.textArea.style.backgroundColor = 'transparent';
        this.textArea.style.cursor = 'default';
        this.textArea.placeholder = 'Enter marginalia text...';
        this.textArea.tabIndex = 0; // Make sure it's focusable

        // Get the current language setting
        const secondaryLanguageSelect = document.getElementById('secondary-language') as HTMLSelectElement;
        if (secondaryLanguageSelect?.value === 'ancient-greek') {
            this.textArea.style.fontFamily = 'New Athena Unicode, Arial Unicode MS, Lucida Grande, sans-serif';
        }

        // Create resizer handle
        this.resizer.className = 'marginalia-resizer';

        // Add elements to container
        container.appendChild(this.textArea);
        container.appendChild(this.resizer);

        return container;
    }

    private setEditMode(enabled: boolean): void {
        if (enabled) {
            this.textArea.style.cursor = 'text';
            this.textArea.focus();
        } else {
            this.textArea.style.cursor = 'default';
            this.textArea.blur();
        }
    }

    private setupEventListeners(): void {
        // Handle single clicks for selection only
        const handleSingleClick = (e: MouseEvent) => {
            e.stopPropagation();
            e.preventDefault(); // Prevent textarea focus
            // Select this marginalia box without clearing others
            this.element.classList.add('selected');
            this.setEditMode(false);
        };

        // Only handle click on textarea for selection
        this.textArea.addEventListener('click', handleSingleClick);
        this.element.addEventListener('click', handleSingleClick);

        // Handle double-click for text editing
        this.element.addEventListener('dblclick', (e: MouseEvent) => {
            e.stopPropagation();
            // Only allow textarea focus on double click
            if (e.target === this.textArea || e.target === this.element) {
                this.element.classList.add('selected');
                this.setEditMode(true);
            }
        });

        // Handle keyboard events for deletion
        const handleKeyDown = (e: KeyboardEvent) => {
            // Only handle 'x' key if this box is selected and we're not in edit mode
            if (this.element.classList.contains('selected') && e.key === 'x' && document.activeElement !== this.textArea) {
                e.preventDefault();
                // Record delete operation before removing
                const pageContainer = this.element.closest('.canvas-container') as HTMLElement;
                if (pageContainer && window.historyManager) {
                    window.historyManager.addOperation(
                        window.historyManager.createDeleteMarginaliaOperation(this, pageContainer)
                    );
                }
                this.element.remove();
                // Remove the event listener when the element is removed
                document.removeEventListener('keydown', handleKeyDown);
            }
        };

        document.addEventListener('keydown', handleKeyDown);

        // Handle dragging and resizing
        const handleMouseDown = (e: MouseEvent) => {
            // Handle resizer
            if (e.target === this.resizer) {
                this.isResizing = true;
                this.dragStartX = e.clientX;
                this.dragStartY = e.clientY;
                this.initialWidth = this.element.offsetWidth;
                this.initialHeight = this.element.offsetHeight;
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            // Handle dragging from anywhere except when in edit mode
            if (document.activeElement !== this.textArea) {
                this.isDragging = true;
                this.dragStartX = e.clientX;
                this.dragStartY = e.clientY;
                // Store initial position from style values
                this.initialX = parseInt(this.element.style.left) || 0;
                this.initialY = parseInt(this.element.style.top) || 0;
                e.preventDefault();
                e.stopPropagation();
            }
        };

        this.element.addEventListener('mousedown', handleMouseDown);

        // Handle movement
        document.addEventListener('mousemove', (e: MouseEvent) => {
            if (this.isDragging) {
                e.preventDefault();
                this.drag(e);
            } else if (this.isResizing) {
                e.preventDefault();
                this.resize(e);
            }
        });

        document.addEventListener('mouseup', () => {
            this.handleDragEnd();
        });
    }

    private drag(e: MouseEvent): void {
        if (!this.isDragging) return;

        const deltaX = e.clientX - this.dragStartX;
        const deltaY = e.clientY - this.dragStartY;

        const newX = this.initialX + deltaX;
        const newY = this.initialY + deltaY;

        console.log('Dragging:', {
            deltaX,
            deltaY,
            newX,
            newY,
            initialX: this.initialX,
            initialY: this.initialY
        });

        this.element.style.left = `${newX}px`;
        this.element.style.top = `${newY}px`;
    }

    private resize(e: MouseEvent): void {
        if (!this.isResizing) return;

        const deltaX = e.clientX - this.dragStartX;
        const deltaY = e.clientY - this.dragStartY;

        const newWidth = Math.max(150, this.initialWidth + deltaX);
        const newHeight = Math.max(100, this.initialHeight + deltaY);

        this.element.style.width = `${newWidth}px`;
        this.element.style.height = `${newHeight}px`;
    }

    private handleDragEnd(): void {
        if (this.isDragging) {
            const finalX = parseInt(this.element.style.left) || 0;
            const finalY = parseInt(this.element.style.top) || 0;
            
            console.log('Drag ended:', {
                initialX: this.initialX,
                initialY: this.initialY,
                finalX: finalX,
                finalY: finalY,
                currentStyle: {
                    left: this.element.style.left,
                    top: this.element.style.top
                }
            });
            
            // Only record the operation if the position actually changed
            if (finalX !== this.initialX || finalY !== this.initialY) {
                console.log('Position changed, creating move operation');
                const pageContainer = this.element.closest('.canvas-container') as HTMLElement;
                if (pageContainer && window.historyManager) {
                    const operation = window.historyManager.createMoveMarginaliaOperation(
                        this,
                        this.initialX,
                        this.initialY,
                        finalX,
                        finalY
                    );
                    console.log('Created move operation:', operation);
                    window.historyManager.addOperation(operation);
                } else {
                    console.log('Missing pageContainer or historyManager:', {
                        pageContainer: !!pageContainer,
                        historyManager: !!window.historyManager
                    });
                }
            } else {
                console.log('Position did not change, no operation created');
            }
        }
        this.isDragging = false;
        this.isResizing = false;
    }

    public getElement(): HTMLElement {
        return this.element;
    }

    public getId(): string {
        return this.id;
    }

    public getState(): { id: string; x: number; y: number; width: number; height: number; text: string; isGreekText: boolean; } {
        return {
            id: this.id,
            x: this.element.offsetLeft,
            y: this.element.offsetTop,
            width: this.element.offsetWidth,
            height: this.element.offsetHeight,
            text: this.textArea.value,
            isGreekText: this.textArea.style.fontFamily.includes('New Athena Unicode')
        };
    }

    public setText(text: string): void {
        this.textArea.value = text;
    }

    public setDimensions(width: number, height: number): void {
        this.element.style.width = `${width}px`;
        this.element.style.height = `${height}px`;
    }

    public static fromElement(element: HTMLElement | null): Marginalia | undefined {
        if (!element) return undefined;
        return Marginalia.instances.get(element.id);
    }

    public static updateInstanceId(oldId: string, newId: string, instance: Marginalia): void {
        Marginalia.instances.delete(oldId);
        Marginalia.instances.set(newId, instance);
    }

    public getText(): string {
        return this.textArea.value;
    }
} 