import { WordBox } from './wordbox.js';
import { TextLine } from './textline.js';
import { CanvasManager } from './canvas-manager.js';
import { getAllConnectedBoxes, updateChildBoxPosition } from './wordbox.js';
import { CAP_HEIGHT } from './constants.js';

interface CanvasOperation {
    type: 'addBox' | 'deleteBox' | 'moveBox' | 'addLine' | 'deleteLine' | 'editBox' | 'moveLine' | 'addMarginalia' | 'deleteMarginalia' | 'moveMarginalia' | 'editMarginalia' | 'save';
    data: any;
    undo: () => void;
    redo: () => void;
}

export class HistoryManager {
    private undoStack: CanvasOperation[] = [];
    private redoStack: CanvasOperation[] = [];
    private canvasManager: CanvasManager;
    private updateModifiedState: () => void;

    constructor(canvasManager: CanvasManager, updateModifiedState: () => void) {
        this.canvasManager = canvasManager;
        this.updateModifiedState = updateModifiedState;
    }

    public clearHistory(): void {
        this.undoStack = [];
        this.redoStack = [];
        this.updateModifiedState();
    }

    public hasUnsavedChanges(): boolean {
        const lastSaveIndex = [...this.undoStack].reverse().findIndex(op => op.type === 'save');
        
        if (lastSaveIndex === -1) {
            return this.undoStack.length > 0;
        }
        
        return lastSaveIndex > 0;
    }

    public addOperation(operation: CanvasOperation): void {
        // Clear redo stack when a new operation is added
        this.redoStack = [];
        console.log('Adding operation:', operation.type, operation.data);
        this.undoStack.push(operation);
        console.log('Current undo stack:', this.undoStack.map(op => ({ type: op.type, data: op.data })));
        this.updateModifiedState();
    }

    public undo(): void {
        const operation = this.undoStack[this.undoStack.length - 1];
        if (!operation) return;

        console.log('Undoing operation:', operation.type, operation.data);
        console.log('Current undo stack before undo:', this.undoStack.map(op => ({ type: op.type, data: op.data })));

        // For add box operations, check if it's safe to undo
        if (operation.type === 'addBox') {
            const wordBox = operation.data.instance;
            // If this box has children, we can't undo it yet
            if (wordBox.getChildBoxIdTop() || wordBox.getChildBoxIdBottom()) {
                return;
            }
        }

        // For addMarginalia operations, check if there are any move operations that should be undone first
        if (operation.type === 'addMarginalia') {
            // Look for the most recent move operation for this marginalia
            for (let i = this.undoStack.length - 2; i >= 0; i--) {
                const op = this.undoStack[i];
                if (op.type === 'moveMarginalia' && op.data.marginalia === operation.data.instance) {
                    console.log('Found move operation to undo first:', op);
                    // Undo the move operation first
                    this.undoStack.splice(i, 1);
                    op.undo();
                    this.redoStack.push(op);
                    return;
                }
            }
        }

        // Safe to undo
        this.undoStack.pop();
        operation.undo();
        this.redoStack.push(operation);
        console.log('Current undo stack after undo:', this.undoStack.map(op => ({ type: op.type, data: op.data })));
    }

    public redo(): void {
        const operation = this.redoStack.pop();
        if (operation) {
            console.log('Redoing operation:', operation.type, operation.data);
            operation.redo();
            this.undoStack.push(operation);
        }
    }

    public createAddBoxOperation(wordBox: WordBox, pageContainer: HTMLElement): CanvasOperation {
        const parentId = wordBox.getParentId();
        const boxData = {
            element: wordBox.getElement(),
            instance: wordBox,
            pageContainer: pageContainer,
            lineId: wordBox.getLineId(),
            // Store parent/child relationships
            parentId: parentId,
            // Check if this is a top or bottom child by checking the parent's references
            isTopChild: parentId ? WordBox.instances.get(parentId)?.getChildBoxIdTop() === wordBox.getId() : false,
            isBottomChild: parentId ? WordBox.instances.get(parentId)?.getChildBoxIdBottom() === wordBox.getId() : false
        };

        return {
            type: 'addBox',
            data: boxData,
            undo: () => {
                // Clear parent/child relationships before removing
                if (boxData.parentId) {
                    const parentBox = WordBox.instances.get(boxData.parentId);
                    if (parentBox) {
                        const parentElement = parentBox.getElement();
                        
                        // Restore the appropriate circle based on which type of child this was
                        if (parentBox.getChildBoxIdTop() === wordBox.getId()) {
                            parentBox.setChildBoxIdTop(undefined);
                            // Create and add top circle
                            const topLine = document.createElement('div');
                            topLine.className = 'wordbox-line-top';
                            const topCircle = document.createElement('div');
                            topCircle.className = 'wordbox-circle-top';
                            parentElement.appendChild(topLine);
                            parentElement.appendChild(topCircle);
                        }
                        if (parentBox.getChildBoxIdBottom() === wordBox.getId()) {
                            parentBox.setChildBoxIdBottom(undefined);
                            // Create and add bottom circle
                            const bottomLine = document.createElement('div');
                            bottomLine.className = 'wordbox-line-bottom';
                            const bottomCircle = document.createElement('div');
                            bottomCircle.className = 'wordbox-circle-bottom';
                            parentElement.appendChild(bottomLine);
                            parentElement.appendChild(bottomCircle);
                        }
                    }
                }

                // Remove the box
                boxData.element.remove();
                WordBox.instances.delete(wordBox.getId());
                
                // Remove from line if it was on one
                if (boxData.lineId) {
                    const pageNumber = parseInt(boxData.lineId.split('-')[1]);
                    const lines = this.canvasManager.getTextLines().get(pageNumber) || [];
                    const line = lines.find(l => l.getId() === boxData.lineId);
                    if (line) {
                        line.removeWordBox(boxData.instance);
                    }
                }
            },
            redo: () => {
                // Restore the box
                boxData.pageContainer.appendChild(boxData.element);
                WordBox.instances.set(wordBox.getId(), wordBox);
                
                // Restore parent/child relationships
                if (boxData.parentId) {
                    const parentBox = WordBox.instances.get(boxData.parentId);
                    if (parentBox) {
                        const parentElement = parentBox.getElement();
                        wordBox.setParentId(boxData.parentId);

                        // Remove the appropriate circle and line before setting the child
                        if (boxData.isTopChild) {
                            const topCircle = parentElement.querySelector('.wordbox-circle-top');
                            const topLine = parentElement.querySelector('.wordbox-line-top');
                            if (topCircle) topCircle.remove();
                            if (topLine) topLine.remove();
                            parentBox.setChildBoxIdTop(wordBox.getId());
                        } else if (boxData.isBottomChild) {
                            const bottomCircle = parentElement.querySelector('.wordbox-circle-bottom');
                            const bottomLine = parentElement.querySelector('.wordbox-line-bottom');
                            if (bottomCircle) bottomCircle.remove();
                            if (bottomLine) bottomLine.remove();
                            parentBox.setChildBoxIdBottom(wordBox.getId());
                        }
                    }
                }
                
                // Reattach to line if it was on one
                if (boxData.lineId) {
                    const pageNumber = parseInt(boxData.lineId.split('-')[1]);
                    const lines = this.canvasManager.getTextLines().get(pageNumber) || [];
                    const line = lines.find(l => l.getId() === boxData.lineId);
                    if (line) {
                        line.addWordBox(boxData.instance);
                    }
                }
            }
        };
    }

    public createDeleteBoxOperation(wordBox: WordBox, pageContainer: HTMLElement): CanvasOperation {
        // Get all connected boxes before deletion
        const connectedBoxes = getAllConnectedBoxes(wordBox);
        const boxData = {
            connectedBoxes: connectedBoxes.map(box => ({
                element: box.getElement(),
                instance: box,
                lineId: box.getLineId()
            })),
            pageContainer: pageContainer
        };

        return {
            type: 'deleteBox',
            data: boxData,
            undo: () => {
                // Restore all connected boxes
                boxData.connectedBoxes.forEach(boxInfo => {
                    // First ensure the element is in the DOM
                    boxData.pageContainer.appendChild(boxInfo.element);
                    // Add back to WordBox instances
                    WordBox.instances.set(boxInfo.instance.getId(), boxInfo.instance);
                    
                    // Reattach to line if it was on one
                    if (boxInfo.lineId) {
                        const pageNumber = parseInt(boxInfo.lineId.split('-')[1]);
                        const lines = this.canvasManager.getTextLines().get(pageNumber) || [];
                        const line = lines.find(l => l.getId() === boxInfo.lineId);
                        if (line) {
                            line.addWordBox(boxInfo.instance);
                        }
                    }
                });
            },
            redo: () => {
                // Remove all connected boxes
                boxData.connectedBoxes.forEach(boxInfo => {
                    boxInfo.element.remove();
                    WordBox.instances.delete(boxInfo.instance.getId());
                    
                    // Remove from line if it was on one
                    if (boxInfo.lineId) {
                        const pageNumber = parseInt(boxInfo.lineId.split('-')[1]);
                        const lines = this.canvasManager.getTextLines().get(pageNumber) || [];
                        const line = lines.find(l => l.getId() === boxInfo.lineId);
                        if (line) {
                            line.removeWordBox(boxInfo.instance);
                        }
                    }
                });
            }
        };
    }

    public createMoveBoxOperation(wordBox: WordBox, startX: number, startY: number, endX: number, endY: number): CanvasOperation {
        // Get all connected boxes and their initial positions
        const connectedBoxes = getAllConnectedBoxes(wordBox);
        const moveData = {
            wordBox: wordBox,
            startX: startX,
            startY: startY,
            endX: endX,
            endY: endY,
            // Store initial state for all connected boxes
            connectedBoxes: connectedBoxes.map(box => {
                const parentId = box.getParentId();
                const boxId = box.getId();
                const element = box.getElement();
                const startX = parseInt(element.style.left);
                const startY = parseInt(element.style.top);

                // If this is a child box, store its position relative to its parent
                let deltaX = 0;
                let deltaY = 0;
                if (parentId) {
                    const parentBox = WordBox.instances.get(parentId);
                    if (parentBox) {
                        const parentElement = parentBox.getElement();
                        deltaX = startX - parseInt(parentElement.style.left);
                        deltaY = startY - parseInt(parentElement.style.top);
                    }
                }

                return {
                    instance: box,
                    lineId: box.getLineId(),
                    parentId: parentId,
                    isTopChild: parentId && boxId ? WordBox.instances.get(parentId)?.getChildBoxIdTop() === boxId : false,
                    isBottomChild: parentId && boxId ? WordBox.instances.get(parentId)?.getChildBoxIdBottom() === boxId : false,
                    startX: startX,
                    startY: startY,
                    deltaX: deltaX,
                    deltaY: deltaY
                };
            }),
            // Find the root box (box with no parent)
            rootBox: connectedBoxes.find(box => !box.getParentId()) || wordBox,
            // Store the page container
            pageContainer: wordBox.getElement().closest('.canvas-container') as HTMLElement
        };

        return {
            type: 'moveBox',
            data: moveData,
            undo: () => {
                // First clear any current line references for all connected boxes
                moveData.connectedBoxes.forEach(boxInfo => {
                    const currentLineId = boxInfo.instance.getLineId();
                    if (currentLineId) {
                        const pageNumber = parseInt(currentLineId.split('-')[1]);
                        const lines = this.canvasManager.getTextLines().get(pageNumber) || [];
                        const currentLine = lines.find(l => l.getId() === currentLineId);
                        if (currentLine) {
                            currentLine.removeWordBox(boxInfo.instance);
                        }
                    }
                });

                // First ensure all boxes are in the DOM
                moveData.connectedBoxes.forEach(boxInfo => {
                    const element = boxInfo.instance.getElement();
                    if (!element.parentElement) {
                        moveData.pageContainer.appendChild(element);
                    }
                });

                // Then restore parent-child relationships
                moveData.connectedBoxes.forEach(boxInfo => {
                    if (boxInfo.parentId) {
                        const parentBox = WordBox.instances.get(boxInfo.parentId);
                        if (parentBox) {
                            boxInfo.instance.setParentId(boxInfo.parentId);
                            const boxId = boxInfo.instance.getId();
                            if (boxId && boxInfo.isTopChild) {
                                parentBox.setChildBoxIdTop(boxId);
                            } else if (boxId && boxInfo.isBottomChild) {
                                parentBox.setChildBoxIdBottom(boxId);
                            }
                        }
                    }
                });

                // Move root box back to its original position
                moveData.rootBox.getElement().style.left = `${moveData.startX}px`;
                moveData.rootBox.getElement().style.top = `${moveData.startY}px`;

                // Move each child box back to its original position relative to its parent
                moveData.connectedBoxes.forEach(boxInfo => {
                    if (boxInfo.parentId) {
                        const parentBox = WordBox.instances.get(boxInfo.parentId);
                        if (parentBox) {
                            const parentElement = parentBox.getElement();
                            const parentX = parseInt(parentElement.style.left);
                            const parentY = parseInt(parentElement.style.top);
                            const element = boxInfo.instance.getElement();
                            element.style.left = `${parentX + boxInfo.deltaX}px`;
                            element.style.top = `${parentY + boxInfo.deltaY}px`;
                        }
                    }
                });

                // Then reattach to original lines if they existed, preventing snapping
                moveData.connectedBoxes.forEach(boxInfo => {
                    if (boxInfo.lineId) {
                        const pageNumber = parseInt(boxInfo.lineId.split('-')[1]);
                        const lines = this.canvasManager.getTextLines().get(pageNumber) || [];
                        const line = lines.find(l => l.getId() === boxInfo.lineId);
                        if (line) {
                            line.setPreventSnap(true);
                            line.addWordBox(boxInfo.instance);
                            line.setPreventSnap(false);
                        }
                    }
                });
            },
            redo: () => {
                // First remove from original lines
                moveData.connectedBoxes.forEach(boxInfo => {
                    if (boxInfo.lineId) {
                        const pageNumber = parseInt(boxInfo.lineId.split('-')[1]);
                        const lines = this.canvasManager.getTextLines().get(pageNumber) || [];
                        const line = lines.find(l => l.getId() === boxInfo.lineId);
                        if (line) {
                            line.removeWordBox(boxInfo.instance);
                            boxInfo.instance.setLineId(undefined);
                        }
                    }
                });

                // Ensure all boxes are attached to the page container
                moveData.connectedBoxes.forEach(boxInfo => {
                    const element = boxInfo.instance.getElement();
                    if (!element.parentElement) {
                        moveData.pageContainer.appendChild(element);
                    }
                });

                // Restore parent-child relationships
                moveData.connectedBoxes.forEach(boxInfo => {
                    if (boxInfo.parentId) {
                        const parentBox = WordBox.instances.get(boxInfo.parentId);
                        if (parentBox) {
                            boxInfo.instance.setParentId(boxInfo.parentId);
                            const boxId = boxInfo.instance.getId();
                            if (boxId && boxInfo.isTopChild) {
                                parentBox.setChildBoxIdTop(boxId);
                            } else if (boxId && boxInfo.isBottomChild) {
                                parentBox.setChildBoxIdBottom(boxId);
                            }
                        }
                    }
                });

                // Move root box to new position
                moveData.rootBox.getElement().style.left = `${moveData.endX}px`;
                moveData.rootBox.getElement().style.top = `${moveData.endY}px`;

                // Update all child positions
                updateChildBoxPosition(moveData.rootBox);

                // Find the page the root box is currently over
                const pageContainer = moveData.rootBox.getElement().closest('.canvas-container') as HTMLElement;
                if (pageContainer) {
                    const canvas = pageContainer.querySelector('canvas');
                    if (canvas) {
                        const rect = canvas.getBoundingClientRect();
                        const containerRect = pageContainer.getBoundingClientRect();
                        const scaleY = canvas.height / rect.height;
                        
                        // Get the page number
                        const pageNumber = parseInt(pageContainer.dataset.pageNumber || '1');
                        
                        // Get all lines on this page
                        const lines = this.canvasManager.getTextLines().get(pageNumber) || [];
                        
                        // Find the closest line
                        let minDistance = Infinity;
                        let closestLine: TextLine | null = null;
                        
                        const wordboxRect = moveData.rootBox.getElement().getBoundingClientRect();
                        const wordboxCenter = wordboxRect.top + (wordboxRect.height / 2) - containerRect.top;
                        
                        for (const line of lines) {
                            const lineY = line.getYPosition();
                            const lineScreenY = lineY / scaleY;
                            const lineCenter = lineScreenY - CAP_HEIGHT;
                            
                            const distance = Math.abs(wordboxCenter - lineCenter);
                            
                            if (distance < minDistance && distance < 25) {
                                minDistance = distance;
                                closestLine = line;
                            }
                        }

                        // If we're near a line, snap to it
                        if (closestLine) {
                            closestLine.addWordBox(moveData.rootBox);
                        }
                    }
                }
            }
        };
    }

    public createEditBoxOperation(wordBox: WordBox, oldText: string, newText: string): CanvasOperation {
        const editData = {
            wordBox: wordBox,
            oldText: oldText,
            newText: newText
        };

        return {
            type: 'editBox',
            data: editData,
            undo: () => {
                const rect = editData.wordBox.getElement().querySelector('.wordbox-rect') as HTMLElement;
                if (rect) {
                    rect.textContent = editData.oldText;
                }
            },
            redo: () => {
                const rect = editData.wordBox.getElement().querySelector('.wordbox-rect') as HTMLElement;
                if (rect) {
                    rect.textContent = editData.newText;
                }
            }
        };
    }

    public createAddLineOperation(line: TextLine, pageNumber: number): CanvasOperation {
        const lineData = {
            line: line,
            pageNumber: pageNumber,
            yPosition: line.getYPosition()
        };

        return {
            type: 'addLine',
            data: lineData,
            undo: () => {
                const lines = this.canvasManager.getTextLines().get(pageNumber) || [];
                const index = lines.indexOf(line);
                if (index !== -1) {
                    lines.splice(index, 1);
                }

                // Clear any word box references to this line
                const wordBoxes = line.getWordBoxes();
                wordBoxes.forEach(box => {
                    box.setLineId(undefined);
                });

                // Redraw the canvas
                const canvas = document.querySelector(`.canvas-container[data-page-number="${pageNumber}"] canvas`) as HTMLCanvasElement;
                if (canvas) {
                    this.canvasManager.clearCanvas(canvas);
                    this.canvasManager.drawAllLines(canvas);
                }
            },
            redo: () => {
                const lines = this.canvasManager.getTextLines().get(pageNumber) || [];
                
                // Restore the line's Y position
                line.setYPosition(lineData.yPosition);
                
                lines.push(line);

                // Redraw the canvas
                const canvas = document.querySelector(`.canvas-container[data-page-number="${pageNumber}"] canvas`) as HTMLCanvasElement;
                if (canvas) {
                    this.canvasManager.clearCanvas(canvas);
                    this.canvasManager.drawAllLines(canvas);
                }
            }
        };
    }

    public createDeleteLineOperation(line: TextLine, pageNumber: number): CanvasOperation {
        const lineData = {
            line: line,
            pageNumber: pageNumber,
            yPosition: line.getYPosition(),
            wordBoxes: line.getWordBoxes().map(box => ({
                instance: box,
                lineId: box.getLineId()
            }))
        };

        return {
            type: 'deleteLine',
            data: lineData,
            undo: () => {
                // Get or create the lines array for this page
                let lines = this.canvasManager.getTextLines().get(pageNumber);
                if (!lines) {
                    lines = [];
                    this.canvasManager.getTextLines().set(pageNumber, lines);
                }
                
                // Restore the line's Y position
                line.setYPosition(lineData.yPosition);
                
                // Add the line back to the array
                lines.push(lineData.line);
                
                // First clear any current line references
                lineData.wordBoxes.forEach(boxInfo => {
                    const currentLineId = boxInfo.instance.getLineId();
                    if (currentLineId) {
                        const pageNumber = parseInt(currentLineId.split('-')[1]);
                        const lines = this.canvasManager.getTextLines().get(pageNumber) || [];
                        const currentLine = lines.find(l => l.getId() === currentLineId);
                        if (currentLine) {
                            currentLine.removeWordBox(boxInfo.instance);
                        }
                    }
                });

                // Then reattach to the original line
                lineData.wordBoxes.forEach(boxInfo => {
                    lineData.line.addWordBox(boxInfo.instance);
                });

                // Redraw the canvas
                const canvas = document.querySelector(`.canvas-container[data-page-number="${pageNumber}"] canvas`) as HTMLCanvasElement;
                if (canvas) {
                    this.canvasManager.clearCanvas(canvas);
                    this.canvasManager.drawAllLines(canvas);
                }
            },
            redo: () => {
                const lines = this.canvasManager.getTextLines().get(pageNumber) || [];
                const index = lines.indexOf(lineData.line);
                if (index !== -1) {
                    lines.splice(index, 1);
                }
                
                // Clear references between line and word boxes
                lineData.wordBoxes.forEach(boxInfo => {
                    lineData.line.removeWordBox(boxInfo.instance);
                    boxInfo.instance.setLineId(undefined);
                });

                // Redraw the canvas
                const canvas = document.querySelector(`.canvas-container[data-page-number="${pageNumber}"] canvas`) as HTMLCanvasElement;
                if (canvas) {
                    this.canvasManager.clearCanvas(canvas);
                    this.canvasManager.drawAllLines(canvas);
                }
            }
        };
    }

    public createMoveLineOperation(line: TextLine, startY: number, endY: number, pageNumber: number): CanvasOperation {
        const moveData = {
            line: line,
            startY: startY,
            endY: endY,
            pageNumber: pageNumber
        };

        return {
            type: 'moveLine',
            data: moveData,
            undo: () => {
                // Move line back to original position
                line.setYPosition(moveData.startY);

                // Redraw the canvas
                const canvas = document.querySelector(`.canvas-container[data-page-number="${pageNumber}"] canvas`) as HTMLCanvasElement;
                if (canvas) {
                    this.canvasManager.clearCanvas(canvas);
                    this.canvasManager.drawAllLines(canvas);
                }
            },
            redo: () => {
                // Move line to new position
                line.setYPosition(moveData.endY);

                // Redraw the canvas
                const canvas = document.querySelector(`.canvas-container[data-page-number="${pageNumber}"] canvas`) as HTMLCanvasElement;
                if (canvas) {
                    this.canvasManager.clearCanvas(canvas);
                    this.canvasManager.drawAllLines(canvas);
                }
            }
        };
    }

    public createAddMarginaliaOperation(marginalia: any, pageContainer: HTMLElement): CanvasOperation {
        const marginaliaData = {
            element: marginalia.getElement(),
            instance: marginalia,
            pageContainer: pageContainer,
            x: parseInt(marginalia.getElement().style.left),
            y: parseInt(marginalia.getElement().style.top),
            width: parseInt(marginalia.getElement().style.width),
            height: parseInt(marginalia.getElement().style.height),
            text: marginalia.getText()
        };

        return {
            type: 'addMarginalia',
            data: marginaliaData,
            undo: () => {
                // Remove the marginalia box
                marginaliaData.element.remove();
            },
            redo: () => {
                // Restore the marginalia box
                marginaliaData.pageContainer.appendChild(marginaliaData.element);
                marginaliaData.element.style.left = `${marginaliaData.x}px`;
                marginaliaData.element.style.top = `${marginaliaData.y}px`;
                marginaliaData.element.style.width = `${marginaliaData.width}px`;
                marginaliaData.element.style.height = `${marginaliaData.height}px`;
                marginaliaData.instance.setText(marginaliaData.text);
            }
        };
    }

    public createDeleteMarginaliaOperation(marginalia: any, pageContainer: HTMLElement): CanvasOperation {
        const marginaliaData = {
            element: marginalia.getElement(),
            instance: marginalia,
            pageContainer: pageContainer,
            x: parseInt(marginalia.getElement().style.left),
            y: parseInt(marginalia.getElement().style.top),
            width: parseInt(marginalia.getElement().style.width),
            height: parseInt(marginalia.getElement().style.height),
            text: marginalia.getText()
        };

        return {
            type: 'deleteMarginalia',
            data: marginaliaData,
            undo: () => {
                // Restore the marginalia box
                marginaliaData.pageContainer.appendChild(marginaliaData.element);
                marginaliaData.element.style.left = `${marginaliaData.x}px`;
                marginaliaData.element.style.top = `${marginaliaData.y}px`;
                marginaliaData.element.style.width = `${marginaliaData.width}px`;
                marginaliaData.element.style.height = `${marginaliaData.height}px`;
                marginaliaData.instance.setText(marginaliaData.text);
            },
            redo: () => {
                // Remove the marginalia box
                marginaliaData.element.remove();
            }
        };
    }

    public createMoveMarginaliaOperation(marginalia: any, startX: number, startY: number, endX: number, endY: number): CanvasOperation {
        const moveData = {
            marginalia: marginalia,
            startX: startX,
            startY: startY,
            endX: endX,
            endY: endY
        };

        return {
            type: 'moveMarginalia',
            data: moveData,
            undo: () => {
                moveData.marginalia.getElement().style.left = `${moveData.startX}px`;
                moveData.marginalia.getElement().style.top = `${moveData.startY}px`;
            },
            redo: () => {
                moveData.marginalia.getElement().style.left = `${moveData.endX}px`;
                moveData.marginalia.getElement().style.top = `${moveData.endY}px`;
            }
        };
    }

    public createEditMarginaliaOperation(marginalia: any, oldText: string, newText: string): CanvasOperation {
        const editData = {
            marginalia: marginalia,
            oldText: oldText,
            newText: newText
        };

        return {
            type: 'editMarginalia',
            data: editData,
            undo: () => {
                editData.marginalia.setText(editData.oldText);
            },
            redo: () => {
                editData.marginalia.setText(editData.newText);
            }
        };
    }

    public createSaveOperation(): CanvasOperation {
        return {
            type: 'save',
            data: { timestamp: Date.now() },
            undo: () => {}, // No-op
            redo: () => {}  // No-op
        };
    }
} 