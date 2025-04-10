import { WordBox } from './wordbox.js';
import { TextLine } from './textline.js';
import { CAP_HEIGHT, ASCENDER_HEIGHT, PAGE_MARGIN, BODY_HEIGHT, DESCENDER_HEIGHT } from './constants.js';
import { CanvasManager } from './canvas-manager.js';
import { getConnectedBoxWidths } from './renderer.js';
import { HistoryManager } from './history-manager.js';
import { Lexicon } from './lexicon.js';

export class WordBoxManager {
    private currentlyHighlightedBox: HTMLElement | null = null;
    private currentlyHighlightedCircle: HTMLElement | null = null;
    private globalIsDragging = false;
    private draggedWordBox: WordBox | null = null;
    private dragStartX = 0;
    private dragStartY = 0;
    private initialWordBoxX = 0;
    private initialWordBoxY = 0;
    private closestLine: TextLine | null = null;
    private canvasManager: CanvasManager | null = null;
    private historyManager: HistoryManager | null = null;
    private lastNavigatedFromTop: boolean = false;
    private lastNavigatedFromBottom: boolean = false;
    private isEditOperationAdded: boolean = false;
    private snapLineId: string | null = null;
    private snapReleaseDistance: number = 50; // Pixels to move away to release snap
    private snapThreshold: number = 40; // Increased from 25 to 40 pixels

    constructor() {
        this.setupEventListeners();
        // Make this instance globally available for the language dropdown
        (window as any).wordBoxManager = this;
    }

    setCanvasManager(canvasManager: CanvasManager) {
        this.canvasManager = canvasManager;
    }

    setHistoryManager(historyManager: HistoryManager) {
        this.historyManager = historyManager;
    }

    private setupEventListeners() {
        // Add keydown event listener for deleting selected word boxes
        document.addEventListener('keydown', (e) => {            
            this.handleKeyDown(e);
        });

        // Add double-click handler for text editing and child box creation
        document.addEventListener('dblclick', this.handleDoubleClick.bind(this));

        // Add click handler for word box selection
        document.addEventListener('click', this.handleClick.bind(this));

        // Add mouse event handlers for word box dragging
        document.addEventListener('mousedown', this.handleMouseDown.bind(this));
        document.addEventListener('mousemove', this.handleMouseMove.bind(this));
        document.addEventListener('mouseup', this.handleMouseUp.bind(this));
    }

    private createAndSetupInput(rectContainer: HTMLElement, wordBoxEl: HTMLElement, measureSpan: HTMLElement, originalText: string) {
        // Store the original text in the dataset for potential restoration
        rectContainer.dataset.originalText = originalText;
        this.isEditOperationAdded = false;
        
        // Add 'editing' class to the WordBox element
        wordBoxEl.classList.add('editing');
        
        const input = document.createElement('input');
        input.type = 'text';
        input.value = rectContainer.textContent || '';
        input.style.width = '50px';
        input.style.height = '100%';
        input.style.border = 'none';
        input.style.padding = '0 4px';
        input.style.background = 'white';
        input.style.outline = 'none';
        input.style.font = window.getComputedStyle(rectContainer).font;
        input.classList.add('wordbox-editing-input');
        
        // Add a data attribute to identify it as an editing input
        input.dataset.editing = 'true';
        
        // Add special handler to prevent document-level keyboard shortcuts
        input.addEventListener('keydown', (e) => {
            // Stop ALL keyboard events from bubbling up to document level
            e.stopPropagation();
            
            // Don't let h key trigger accelerator menu items
            if (e.key === 'h') {
                e.preventDefault(); // Prevent default only at this level
                // Allow normal text input by setting the value programmatically
                setTimeout(() => {
                    input.value += 'h';
                    // Manually trigger the input event
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }, 0);
            }
        });

        // Function to update input width based on content
        const updateWidth = () => {
            measureSpan.textContent = input.value || input.placeholder;
            const width = measureSpan.getBoundingClientRect().width;
            input.style.width = `${Math.max(50, width + 8)}px`; // Add padding, minimum 50px
        };

        // Replace the text content with the input
        rectContainer.textContent = '';
        rectContainer.appendChild(input);
        
        // Initial width update
        updateWidth();
        
        // Update width while typing
        input.addEventListener('input', () => {
            updateWidth();
            const editedBox = WordBox.fromElement(wordBoxEl);
            if (editedBox) {
                // If this is a parent box with a child, update the child position
                if (editedBox.getChildBoxIdBottom() || editedBox.getChildBoxIdTop()) {
                    this.updateChildBoxPosition(editedBox);
                }
                // If this is a child box, update its position relative to parent
                else {
                    const parentId = editedBox.getParentId();
                    if (parentId) {
                        const parentBox = WordBox.fromElement(document.getElementById(parentId));
                        if (parentBox) {
                            this.updateChildBoxPosition(parentBox);
                        }
                    }
                }
            }
        });

        // Handle keydown events (Enter/Tab)
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();

                // Get the edited box and find its topmost ancestor
                const editedBox = WordBox.fromElement(wordBoxEl);
                if (!editedBox) return;

                // First update the text content to get the final state
                const newText = input.value.trim();
                rectContainer.textContent = newText;

                // Update lexicon with the new text, but only if not a Chapter, Section, or Headline box
                if (!editedBox.getIsChapter() && !editedBox.getIsSection() && !editedBox.getIsHeadline()) {
                    editedBox.updateLexicon(newText, originalText);
                } else {
                    console.log(`Skipping lexicon update for ${editedBox.getIsChapter() ? 'Chapter' : editedBox.getIsSection() ? 'Section' : 'Headline'} box text: "${newText}"`);
                }
                
                // Get the page container and canvas
                const pageContainer = editedBox.getElement().closest('.canvas-container') as HTMLElement;
                if (!pageContainer) return;
                
                const canvas = pageContainer.querySelector('canvas');
                if (!canvas) return;

                const canvasRect = canvas.getBoundingClientRect();
                const containerRect = pageContainer.getBoundingClientRect();
                const scaleY = canvas.height / canvasRect.height;

                // Get the margins to check if we need to create a new line
                const margins = this.canvasManager?.getGlobalMargins();
                if (!margins) return;

                // Check if the edited box would extend beyond the right margin
                const boxLeft = editedBox.getLeft();
                const boxWidth = rectContainer.getBoundingClientRect().width;
                const wouldExtendBeyondMargin = boxLeft + boxWidth > margins.right;

                if (wouldExtendBeyondMargin) {
                    // Find the current line
                    const pageNumber = parseInt(pageContainer.dataset.pageNumber || '1');
                    const lines = this.getTextLines(pageNumber) || [];
                    const currentLine = lines.find(line => line.getId() === editedBox.getLineId());

                    if (currentLine) {
                        // Find the box with the highest y value among all boxes attached to the line
                        const attachedBoxes = currentLine.getWordBoxes();
                        let maxBottomY = currentLine.getYPosition();

                        attachedBoxes.forEach(box => {
                            const boxRect = box.getElement().getBoundingClientRect();
                            const boxBottom = (boxRect.bottom - containerRect.top) * scaleY;
                            maxBottomY = Math.max(maxBottomY, boxBottom);

                            // Also check any child boxes
                            const childBoxIdBottom = box.getChildBoxIdBottom();
                            if (childBoxIdBottom) {
                                const childBox = WordBox.fromElement(document.getElementById(childBoxIdBottom));
                                if (childBox) {
                                    const childRect = childBox.getElement().getBoundingClientRect();
                                    const childBottom = (childRect.bottom - containerRect.top) * scaleY;
                                    maxBottomY = Math.max(maxBottomY, childBottom);
                                }
                            }
                        });

                        // Create new line below the bottom-most box
                        const newLineY = maxBottomY + BODY_HEIGHT + 27; // Spacing of 27px
                        
                        let newLine: TextLine | undefined;
                        
                        // Check if the new line fits within bottom margin
                        if (newLineY + DESCENDER_HEIGHT <= margins.bottom) {
                            // Line fits on current page
                            newLine = this.canvasManager?.addTextLine(pageNumber, newLineY);
                            if (newLine && this.historyManager) {
                                this.historyManager.addOperation(
                                    this.historyManager.createAddLineOperation(newLine, pageNumber)
                                );
                            }
                        } else {
                            // Line doesn't fit - create a new page and add line at the top
                            const { wrapper } = this.canvasManager?.createPage() || {};
                            
                            if (wrapper) {
                                const newPageNumber = parseInt(wrapper.dataset.pageNumber || '1');
                                
                                // Add a new line near the top of the new page with some space
                                const topMargin = margins.top + CAP_HEIGHT + 20; // Add 20px buffer
                                newLine = this.canvasManager?.addTextLine(newPageNumber, topMargin);
                                
                                if (newLine && this.historyManager) {
                                    this.historyManager.addOperation(
                                        this.historyManager.createAddLineOperation(newLine, newPageNumber)
                                    );
                                }
                            }
                        }
                        
                        if (newLine) {
                            // Remove from current line
                            if (currentLine) {
                                currentLine.removeWordBox(editedBox);
                            }

                            // If the new line is on a different page, move the WordBox to that page
                            const newLinePageNumber = newLine.getPageNumber();
                            if (newLinePageNumber !== pageNumber) {
                                // Find the new page container
                                const newPageContainer = document.querySelector(`.canvas-container[data-page-number="${newLinePageNumber}"]`) as HTMLElement;
                                if (newPageContainer) {
                                    // Move the element to the new page
                                    pageContainer.removeChild(editedBox.getElement());
                                    newPageContainer.appendChild(editedBox.getElement());
                                }
                            }

                            // Position at start of new line
                            editedBox.setX(margins.left + 3);

                            // Get the correct canvas for the line's page
                            const linePageNumber = newLine.getPageNumber();
                            const targetCanvas = document.querySelector(`.canvas-container[data-page-number="${linePageNumber}"] canvas`) as HTMLCanvasElement;
                            const targetRect = targetCanvas.getBoundingClientRect();
                            const targetContainerRect = targetCanvas.parentElement?.getBoundingClientRect();
                            const targetScaleY = targetCanvas.height / targetRect.height;

                            // Calculate snap position for the new line
                            const lineY = newLine.getYPosition();
                            const lineScreenY = lineY / targetScaleY;
                            const lineCenter = lineScreenY - CAP_HEIGHT;
                            
                            const editedBoxRect = editedBox.getElement().getBoundingClientRect();
                            const snapY = lineCenter - (editedBoxRect.height / 2) + ASCENDER_HEIGHT - 16;
                            editedBox.setY(snapY);

                            // Add to new line
                            newLine.addWordBox(editedBox);
                            
                            // Auto-scroll to the new page if a new page was created
                            if (newLine.getPageNumber() !== pageNumber) {
                                const newPageEl = document.querySelector(`.canvas-container[data-page-number="${newLine.getPageNumber()}"]`);
                                if (newPageEl) {
                                    setTimeout(() => {
                                        newPageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                    }, 50);
                                }
                            }
                        }
                    }
                }

                // Check for and snap any unattached boxes
                this.snapUnattachedBoxesToLines(pageContainer);

                // Check for #title or #author in headline boxes when Enter is pressed
                if (e.key === 'Enter' && wordBoxEl.classList.contains('headline')) {
                    if (input.value === '#title') {
                        const documentTitle = document.getElementById('document-title') as HTMLTextAreaElement;
                        if (documentTitle && documentTitle.value.trim()) {
                            input.value = documentTitle.value.trim();
                            updateWidth();
                        }
                    } else if (input.value === '#author') {
                        const documentAuthor = document.getElementById('document-author') as HTMLTextAreaElement;
                        if (documentAuthor && documentAuthor.value.trim()) {
                            input.value = documentAuthor.value.trim();
                            updateWidth();
                        }
                    }
                }

                if (e.key === 'Tab') {
                    // Get the widths of all connected boxes
                    const connectedBoxes = this.getAllConnectedBoxes(editedBox);
                    
                    // Get the glue value from the input field
                    const glueInput = document.getElementById('glue-input') as HTMLInputElement;
                    const glueValue = parseInt(glueInput?.value || '3');
                    
                    // Get the current box's position and width
                    const rect = editedBox.getElement().querySelector('.wordbox-rect') as HTMLElement;

                    // Re-snap the edited box to its line if it has one
                    const editedBoxLineId = editedBox.getLineId();
                    if (editedBoxLineId) {
                        const pageNumber = parseInt(editedBoxLineId.split('-')[1]);
                        const lines = this.getTextLines(pageNumber) || [];
                        const currentLine = lines.find(line => line.getId() === editedBoxLineId);
                        if (currentLine) {
                            const canvas = wordBoxEl.closest('.canvas-container')?.querySelector('canvas') as HTMLCanvasElement;
                            if (canvas) {
                                const canvasRect = canvas.getBoundingClientRect();
                                const containerRect = canvas.parentElement?.getBoundingClientRect();
                                if (containerRect) {
                                    const scaleY = canvas.height / canvasRect.height;
                                    const lineY = currentLine.getYPosition();
                                    const lineScreenY = lineY / scaleY;
                                    const lineCenter = lineScreenY - CAP_HEIGHT;
                                    
                                    // Calculate snap position relative to the container
                                    const editedBoxRect = editedBox.getElement().getBoundingClientRect();
                                    const snapY = lineCenter - (editedBoxRect.height / 2) + ASCENDER_HEIGHT - 16;
                                    editedBox.setY(snapY);
                                }
                            }
                        }
                    }
                    
                    // Find the rightmost edge among all connected boxes
                    let rightmostEdge = 0;
                    connectedBoxes.forEach(box => {
                        const boxRect = box.getElement().querySelector('.wordbox-rect') as HTMLElement;
                        const boxLeft = box.getLeft();
                        const boxWidth = boxRect.getBoundingClientRect().width;
                        const boxRightEdge = boxLeft + boxWidth;
                        rightmostEdge = Math.max(rightmostEdge, boxRightEdge);
                    });
                    
                    // Position new box glue pixels after the rightmost edge
                    let newLeft = rightmostEdge + glueValue;
                    
                    // Find the topmost parent of the current box
                    let topmostAncestor = editedBox;
                    let currentBox = editedBox;
                    while (currentBox.getParentId()) {
                        const ancestorBox = WordBox.fromElement(document.getElementById(currentBox.getParentId()!));
                        if (ancestorBox) {
                            topmostAncestor = ancestorBox;
                            currentBox = ancestorBox;
                        } else {
                            break;
                        }
                    }
                    
                    const topmostY = parseInt(topmostAncestor.getElement().style.top);
                    
                    // Get the page number and lines
                    const pageNumber = parseInt(pageContainer.dataset.pageNumber || '1');
                    const lines = this.getTextLines(pageNumber) || [];
                    
                    // Find the closest line
                    let minDistance = Infinity;
                    let closestLine: TextLine | null = null;
                    
                    const topmostRect = topmostAncestor.getElement().getBoundingClientRect();
                    const topmostCenter = topmostRect.top + (topmostRect.height / 2) - containerRect.top;
                    
                    for (const line of lines) {
                        const lineY = line.getYPosition();
                        const lineScreenY = lineY / scaleY;
                        const lineCenter = lineScreenY - CAP_HEIGHT;
                        
                        const distance = Math.abs(topmostCenter - lineCenter);
                        
                        if (distance < minDistance && distance < 25) {
                            minDistance = distance;
                            closestLine = line;
                        }
                    }

                    // Check if the new box would extend beyond the right margin
                    if (newLeft + rect.getBoundingClientRect().width > margins.right) {
                        // We need to create a new line
                        if (closestLine) {
                            // Find the box with the highest y value among all boxes attached to the line
                            const attachedBoxes = closestLine.getWordBoxes();
                            let maxBottomY = closestLine.getYPosition();

                            attachedBoxes.forEach(box => {
                                const boxRect = box.getElement().getBoundingClientRect();
                                const boxBottom = (boxRect.bottom - containerRect.top) * scaleY;
                                maxBottomY = Math.max(maxBottomY, boxBottom);

                                // Also check any child boxes
                                const childBoxIdBottom = box.getChildBoxIdBottom();
                                if (childBoxIdBottom) {
                                    const childBox = WordBox.fromElement(document.getElementById(childBoxIdBottom));
                                    if (childBox) {
                                        const childRect = childBox.getElement().getBoundingClientRect();
                                        const childBottom = (childRect.bottom - containerRect.top) * scaleY;
                                        maxBottomY = Math.max(maxBottomY, childBottom);
                                    }
                                }
                            });

                            // Create new line below the bottom-most box
                            const newLineY = maxBottomY + BODY_HEIGHT + 27; // Spacing of 27px
                            
                            // Check if the new line would fit within bottom margin
                            if (newLineY + DESCENDER_HEIGHT <= margins.bottom) {
                                const newLine = this.canvasManager?.addTextLine(pageNumber, newLineY);
                                if (newLine) {
                                    if (this.historyManager) {
                                        this.historyManager.addOperation(
                                            this.historyManager.createAddLineOperation(newLine, pageNumber)
                                        );
                                    }
                                    closestLine = newLine;
                                }
                            } else {
                                // Line doesn't fit - create a new page and add a line at the top
                                const { wrapper } = this.canvasManager?.createPage() || {};
                                
                                if (wrapper) {
                                    const newPageNumber = parseInt(wrapper.dataset.pageNumber || '1');
                                    
                                    // Add a new line near the top of the new page with some space
                                    const topMargin = margins.top + CAP_HEIGHT + 20; // Add 20px buffer
                                    const newLine = this.canvasManager?.addTextLine(newPageNumber, topMargin);
                                    
                                    if (newLine) {
                                        if (this.historyManager) {
                                            this.historyManager.addOperation(
                                                this.historyManager.createAddLineOperation(newLine, newPageNumber)
                                            );
                                        }
                                        closestLine = newLine;
                                        
                                        // Auto-scroll to the new page
                                        const newPageEl = document.querySelector(`.canvas-container[data-page-number="${newPageNumber}"]`);
                                        if (newPageEl) {
                                            setTimeout(() => {
                                                newPageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                            }, 50);
                                        }
                                    }
                                }
                            }
                        }

                        // Position the new box at the start of the line (3px from left margin)
                        newLeft = margins.left + 3;
                    }

                    // If closestLine is on a different page than the current page, we need
                    // to find the correct page container for the new WordBox
                    let targetContainer = pageContainer;
                    if (closestLine) {
                        const linePageNumber = closestLine.getPageNumber();
                        if (linePageNumber !== pageNumber) {
                            const newPageContainer = document.querySelector(`.canvas-container[data-page-number="${linePageNumber}"]`) as HTMLElement;
                            if (newPageContainer) {
                                targetContainer = newPageContainer;
                            }
                        }
                    }

                    // Create new box with appropriate position
                    // If we're on a new page, calculate a proper initial Y position
                    let initialY = topmostY;
                    if (closestLine && closestLine.getPageNumber() !== pageNumber) {
                        // For a new page, set the Y position near the top where the new line will be
                        const lineY = closestLine.getYPosition();
                        const canvas = targetContainer.querySelector('canvas') as HTMLCanvasElement;
                        if (canvas) {
                            const canvasRect = canvas.getBoundingClientRect();
                            const scaleY = canvas.height / canvasRect.height;
                            initialY = (lineY / scaleY) - CAP_HEIGHT;
                        }
                    }
                    
                    const newBox = new WordBox(newLeft, initialY);
                    targetContainer.appendChild(newBox.getElement());

                    // Record add operation
                    if (this.historyManager) {
                        this.historyManager.addOperation(
                            this.historyManager.createAddBoxOperation(newBox, targetContainer)
                        );
                    }

                    // If we have a line to snap to, do it
                    if (closestLine) {
                        // Get the canvas for the correct page
                        const canvas = targetContainer.querySelector('canvas') as HTMLCanvasElement;
                        const canvasRect = canvas.getBoundingClientRect();
                        const containerRect = targetContainer.getBoundingClientRect();
                        const scaleY = canvas.height / canvasRect.height;
                        
                        const lineY = closestLine.getYPosition();
                        const lineScreenY = lineY / scaleY;
                        const lineCenter = lineScreenY - CAP_HEIGHT;
                        
                        // Calculate snap position relative to the container
                        const newBoxRect = newBox.getElement().getBoundingClientRect();
                        const snapY = lineCenter - (newBoxRect.height / 2) + ASCENDER_HEIGHT - 16;
                        newBox.setY(snapY);

                        // Add the box to the line
                        closestLine.addWordBox(newBox);
                    }

                    // Check for and snap any unattached boxes
                    this.snapUnattachedBoxesToLines(pageContainer);

                    // Clear all selections first
                    WordBox.instances.forEach(box => {
                        box.setSelected(false);
                        box.setIndividuallySelected(false);
                    });
                    
                    // Select the new box and start editing it
                    newBox.setSelected(true);
                    newBox.setIndividuallySelected(true);
                    this.currentlyHighlightedBox = newBox.getElement();

                    // Also select all connected boxes as a group
                    const allConnectedBoxes = this.getAllConnectedBoxes(newBox);
                    allConnectedBoxes.forEach(box => {
                        if (box !== newBox) {
                            box.setSelected(true);
                        }
                    });

                    const newRectContainer = newBox.getElement().querySelector('.wordbox-rect') as HTMLElement;
                    if (newRectContainer) {
                        // Create a new measure span for the new input
                        const newMeasureSpan = document.createElement('span');
                        newMeasureSpan.style.visibility = 'hidden';
                        newMeasureSpan.style.position = 'absolute';
                        newMeasureSpan.style.font = input.style.font;
                        newMeasureSpan.style.whiteSpace = 'pre';
                        document.body.appendChild(newMeasureSpan);

                        // Create and setup the new input field
                        this.createAndSetupInput(newRectContainer, newBox.getElement(), newMeasureSpan, '');
                    }
                } else if (e.key === 'Enter') {
                    // Only remove measureSpan if it's still in the document
                    if (measureSpan.parentNode) {
                        document.body.removeChild(measureSpan);
                    }

                    // Record edit operation if text changed
                    if (newText !== originalText && this.historyManager && !this.isEditOperationAdded) {
                        this.historyManager.addOperation(
                            this.historyManager.createEditBoxOperation(editedBox, originalText, newText)
                        );
                        this.isEditOperationAdded = true;
                    }

                    // Stop editing
                    input.blur();

                    // Check for and snap any unattached boxes
                    this.snapBoxesAfterEdit(editedBox);

                    // Then handle line attachment
                    let topmostAncestor = editedBox;
                    let currentBox = editedBox;
                    while (currentBox.getParentId()) {
                        const ancestorBox = WordBox.fromElement(document.getElementById(currentBox.getParentId()!));
                        if (ancestorBox) {
                            topmostAncestor = ancestorBox;
                            currentBox = ancestorBox;
                        } else {
                            break;
                        }
                    }

                    // Get the page container and canvas
                    const pageContainer = topmostAncestor.getElement().closest('.canvas-container') as HTMLElement;
                    if (!pageContainer) return;
                    
                    const canvas = pageContainer.querySelector('canvas');
                    if (!canvas) return;

                    const canvasRect = canvas.getBoundingClientRect();
                    const containerRect = pageContainer.getBoundingClientRect();
                    const scaleY = canvas.height / canvasRect.height;
                    
                    // Get the page number and lines
                    const pageNumber = parseInt(pageContainer.dataset.pageNumber || '1');
                    const lines = this.getTextLines(pageNumber) || [];
                    
                    // Find the closest line
                    let minDistance = Infinity;
                    let closestLine: TextLine | null = null;
                    
                    const topmostRect = topmostAncestor.getElement().getBoundingClientRect();
                    const topmostCenter = topmostRect.top + (topmostRect.height / 2) - containerRect.top;
                    
                    for (const line of lines) {
                        const lineY = line.getYPosition();
                        const lineScreenY = lineY / scaleY;
                        const lineCenter = lineScreenY - CAP_HEIGHT;
                        
                        const distance = Math.abs(topmostCenter - lineCenter);
                        
                        if (distance < minDistance && distance < 25) {
                            minDistance = distance;
                            closestLine = line;
                        }
                    }

                    // If we found a close line, snap to it
                    if (closestLine) {
                        const lineY = closestLine.getYPosition();
                        const lineScreenY = lineY / scaleY;
                        const lineCenter = lineScreenY - CAP_HEIGHT;
                        
                        // Calculate snap position relative to the container
                        const snapY = lineCenter - (topmostRect.height / 2) + ASCENDER_HEIGHT - 16;
                        topmostAncestor.getElement().style.top = `${snapY}px`;

                        // Add the topmost ancestor to the line (this will handle all descendants)
                        closestLine.addWordBox(topmostAncestor);
                        
                        // Update positions of all descendants
                        this.updateChildBoxPosition(topmostAncestor);
                    }
                }
            }
        });

        // Handle input blur (when focus is lost)
        input.addEventListener('blur', () => {
            const newText = input.value.trim();
            const oldText = originalText;
            rectContainer.textContent = newText;
            
            // Remove 'editing' class from the WordBox element
            wordBoxEl.classList.remove('editing');
            
            // Only remove measureSpan if it's still in the document
            if (measureSpan.parentNode) {
                document.body.removeChild(measureSpan);
            }

            // Get the word box being edited
            const editedBox = WordBox.fromElement(wordBoxEl);
            if (editedBox) {
                // Update lexicon with the new text, but only if not a Chapter, Section, or Headline box
                if (!editedBox.getIsChapter() && !editedBox.getIsSection() && !editedBox.getIsHeadline()) {
                    editedBox.updateLexicon(newText, oldText);
                } else {
                    console.log(`Skipping lexicon update for ${editedBox.getIsChapter() ? 'Chapter' : editedBox.getIsSection() ? 'Section' : 'Headline'} box text: "${newText}"`);
                }

                // Record edit operation if text changed
                if (newText !== oldText && this.historyManager && !this.isEditOperationAdded) {
                    this.historyManager.addOperation(
                        this.historyManager.createEditBoxOperation(editedBox, oldText, newText)
                    );
                    this.isEditOperationAdded = true;
                }

                // Check for and snap any unattached boxes
                this.snapBoxesAfterEdit(editedBox);

                // Update positions if needed
                if (editedBox.getChildBoxIdBottom() || editedBox.getChildBoxIdTop()) {
                    requestAnimationFrame(() => {
                        this.updateChildBoxPosition(editedBox);
                    });
                } else {
                    const parentId = editedBox.getParentId();
                    if (parentId) {
                        const parentBox = WordBox.fromElement(document.getElementById(parentId));
                        if (parentBox) {
                            requestAnimationFrame(() => {
                                this.updateChildBoxPosition(parentBox);
                            });
                        }
                    }
                }
            }
        });

        // Focus and select all text
        input.focus();
        input.select();

        return input;
    }

    private handleKeyDown(e: KeyboardEvent) {
        // Only handle key events when we're not in an input field
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
            return;
        }

        // Also check if there's any active input field in a wordbox
        const activeInput = document.querySelector('.wordbox-rect input');
        if (activeInput) {
            return;
        }

        // Handle 'w' and 's' keys regardless of what's highlighted
        if (e.key === 'w' || e.key === 's') {
            // Prevent default behavior and stop propagation
            e.preventDefault();
            e.stopPropagation();

            // If we have a highlighted box, handle box navigation
            if (this.currentlyHighlightedBox) {
                this.handleBoxNavigation(e.key);
            }
            // If we have a highlighted circle, handle circle navigation
            else if (this.currentlyHighlightedCircle) {
                this.handleCircleNavigation(e.key);
            }
            return;
        }

        // Handle other keys only when a box is highlighted
        if (this.currentlyHighlightedBox) {
            if (e.key === 'x') {
                console.log("WordBoxManager: Detected 'x' key press on highlighted box");
                
                // Mark that we're handling this delete operation
                (window as any).deleteOperationHandled = true;
                console.log("WordBoxManager: Setting deleteOperationHandled to true");
                
                // Try both stopping propagation and preventing default
                e.stopPropagation();
                e.preventDefault();
            }
            this.handleOtherKeys(e);
        }
    }

    private handleCircleNavigation(key: string) {
        const isTop = this.currentlyHighlightedCircle!.classList.contains('wordbox-circle-top');
        const currentBox = WordBox.fromElement(this.currentlyHighlightedCircle!.closest('[id^="wordbox-"]') as HTMLElement);
        if (!currentBox) return;

        // Clear current circle highlight
        this.currentlyHighlightedCircle!.classList.remove('highlighted');

        let nextCircle: HTMLElement | null = null;
        const currentRect = this.currentlyHighlightedCircle!.getBoundingClientRect();

        if (key === 'w') {
            // Move up
            if (isTop) {
                // Find all boxes with available bottom circles
                const allBoxes = Array.from(document.querySelectorAll('[id^="wordbox-"]'));
                const availableBoxes = allBoxes.filter(box => {
                    const bottomCircle = box.querySelector('.wordbox-circle-bottom') as HTMLElement;
                    if (!bottomCircle) return false;
                    
                    const wb = WordBox.fromElement(box as HTMLElement);
                    if (!wb || wb.getChildBoxIdBottom()) return false;
                    
                    const circleRect = bottomCircle.getBoundingClientRect();
                    return circleRect.bottom < currentRect.top;
                });

                if (availableBoxes.length > 0) {
                    // Find the closest box vertically that's within a reasonable horizontal range
                    const closestBox = availableBoxes.reduce((closest, current) => {
                        const closestCircle = closest.querySelector('.wordbox-circle-bottom') as HTMLElement;
                        const currentCircle = current.querySelector('.wordbox-circle-bottom') as HTMLElement;
                        const closestRect = closestCircle.getBoundingClientRect();
                        const currentRect = currentCircle.getBoundingClientRect();
                        
                        // Check if current box is within horizontal range (20px)
                        const isInRange = Math.abs(currentRect.left - this.currentlyHighlightedCircle!.getBoundingClientRect().left) < 20;
                        if (!isInRange) return closest;
                        
                        // If both are in range, pick the closest vertically
                        const closestDist = Math.abs(closestRect.bottom - this.currentlyHighlightedCircle!.getBoundingClientRect().top);
                        const currentDist = Math.abs(currentRect.bottom - this.currentlyHighlightedCircle!.getBoundingClientRect().top);
                        return currentDist < closestDist ? current : closest;
                    });
                    
                    nextCircle = closestBox.querySelector('.wordbox-circle-bottom');
                }
            } else {
                // Move from bottom circle to top circle of same box
                nextCircle = this.currentlyHighlightedCircle!.closest('[id^="wordbox-"]')?.querySelector('.wordbox-circle-top') || null;
            }
        } else if (key === 's') {
            // Move down
            if (!isTop) {
                // Find all boxes with available top circles
                const allBoxes = Array.from(document.querySelectorAll('[id^="wordbox-"]'));
                const availableBoxes = allBoxes.filter(box => {
                    const topCircle = box.querySelector('.wordbox-circle-top') as HTMLElement;
                    if (!topCircle) return false;
                    
                    const wb = WordBox.fromElement(box as HTMLElement);
                    if (!wb || wb.getChildBoxIdTop()) return false;
                    
                    const circleRect = topCircle.getBoundingClientRect();
                    return circleRect.top > currentRect.bottom;
                });

                if (availableBoxes.length > 0) {
                    // Find the closest box vertically that's within a reasonable horizontal range
                    const closestBox = availableBoxes.reduce((closest, current) => {
                        const closestCircle = closest.querySelector('.wordbox-circle-top') as HTMLElement;
                        const currentCircle = current.querySelector('.wordbox-circle-top') as HTMLElement;
                        const closestRect = closestCircle.getBoundingClientRect();
                        const currentRect = currentCircle.getBoundingClientRect();
                        
                        // Check if current box is within horizontal range (20px)
                        const isInRange = Math.abs(currentRect.left - this.currentlyHighlightedCircle!.getBoundingClientRect().left) < 20;
                        if (!isInRange) return closest;
                        
                        // If both are in range, pick the closest vertically
                        const closestDist = Math.abs(closestRect.top - this.currentlyHighlightedCircle!.getBoundingClientRect().bottom);
                        const currentDist = Math.abs(currentRect.top - this.currentlyHighlightedCircle!.getBoundingClientRect().bottom);
                        return currentDist < closestDist ? current : closest;
                    });
                    
                    nextCircle = closestBox.querySelector('.wordbox-circle-top');
                }
            } else {
                // Move from top circle to bottom circle of same box
                nextCircle = this.currentlyHighlightedCircle!.closest('[id^="wordbox-"]')?.querySelector('.wordbox-circle-bottom') || null;
            }
        }

        if (nextCircle) {
            nextCircle.classList.add('highlighted');
            this.currentlyHighlightedCircle = nextCircle;
            
            // Get the parent box of the next circle
            const nextParentBoxEl = nextCircle.closest('[id^="wordbox-"]') as HTMLElement;
            if (nextParentBoxEl) {
                const nextParentBox = WordBox.fromElement(nextParentBoxEl);
                if (nextParentBox) {
                    // Clear previous box selections
                    WordBox.instances.forEach(box => {
                        box.setSelected(false);
                        box.setIndividuallySelected(false);
                    });

                    // Select all connected boxes as a group
                    const connectedBoxes = this.getAllConnectedBoxes(nextParentBox);
                    connectedBoxes.forEach(box => box.setSelected(true));
                }
            }
        }
    }

    private handleBoxNavigation(key: string) {
        if (!this.currentlyHighlightedBox) return;
        
        const currentBox = WordBox.fromElement(this.currentlyHighlightedBox);
        if (!currentBox) return;


        let targetBox: WordBox | undefined;

        if (key === 'w') {
            // If we have a parent and we're a bottom child, move to parent
            if (currentBox.getParentId()) {
                const parentBox = WordBox.fromElement(document.getElementById(currentBox.getParentId()!));
                if (parentBox) {

                    if (parentBox.getChildBoxIdBottom() === currentBox.getId()) {
                        targetBox = parentBox;
                        // Set navigation state
                        targetBox.setLastNavigatedFromBottom(true);
                        targetBox.setLastNavigatedFromTop(false);
                    }
                }
            }
            // Otherwise try to move to top child or connected box above
            if (!targetBox) {
                const topChildId = currentBox.getChildBoxIdTop();
                if (topChildId) {
                    targetBox = WordBox.fromElement(document.getElementById(topChildId));
                    if (targetBox) {
                        // Set navigation state
                        targetBox.setLastNavigatedFromTop(false);
                        targetBox.setLastNavigatedFromBottom(true);
                    }
                }
            }
        } else if (key === 's') {
            // If we have a parent and we're a top child, move to parent
            if (currentBox.getParentId()) {
                const parentBox = WordBox.fromElement(document.getElementById(currentBox.getParentId()!));
                if (parentBox) {

                    if (parentBox.getChildBoxIdTop() === currentBox.getId()) {
                        targetBox = parentBox;
                        // Set navigation state
                        targetBox.setLastNavigatedFromTop(true);
                        targetBox.setLastNavigatedFromBottom(false);
                    }
                }
            }
            // Otherwise try to move to bottom child
            if (!targetBox) {
                const bottomChildId = currentBox.getChildBoxIdBottom();
                if (bottomChildId) {
                    targetBox = WordBox.fromElement(document.getElementById(bottomChildId));
                    if (targetBox) {
                        // Set navigation state
                        targetBox.setLastNavigatedFromTop(true);
                        targetBox.setLastNavigatedFromBottom(false);
                    }
                }
            }
        }

        if (targetBox) {
            // Update selection state
            const connectedBoxes = this.getAllConnectedBoxes(currentBox);
            connectedBoxes.forEach(box => box.setSelected(false));
            
            const targetConnectedBoxes = this.getAllConnectedBoxes(targetBox);
            targetConnectedBoxes.forEach(box => box.setSelected(true));
            
            // Update individual selection
            currentBox.setIndividuallySelected(false);
            targetBox.setIndividuallySelected(true);
            
            // Update highlighted box
            this.currentlyHighlightedBox = targetBox.getElement();
            
        } else {
        }
    }

    private handleOtherKeys(e: KeyboardEvent) {
        const wordBox = WordBox.fromElement(this.currentlyHighlightedBox!);
        if (!wordBox) return;

        if (e.key === 'x') {
            // Delete functionality
            const connectedBoxes = this.getAllConnectedBoxes(wordBox);
            const pageContainer = wordBox.getElement().closest('.canvas-container') as HTMLElement;

            // Record delete operation
            if (this.historyManager) {
                this.historyManager.addOperation(
                    this.historyManager.createDeleteBoxOperation(wordBox, pageContainer)
                );
            }

            connectedBoxes.forEach(box => {
                const lineId = box.getLineId();
                if (lineId) {
                    const pageNumber = parseInt(lineId.split('-')[1]);
                    const lines = this.getTextLines(pageNumber) || [];
                    const currentLine = lines.find(line => line.getId() === lineId);
                    if (currentLine) {
                        currentLine.removeWordBox(box);
                    }
                }
                box.getElement().remove();
                WordBox.instances.delete(box.getId());
            });
            this.currentlyHighlightedBox = null;
            this.currentlyHighlightedCircle = null;
        } else if (e.key === 'c') {
            // Create child node functionality
            e.preventDefault();
            
            // First, remove any existing input field and save its content
            const existingInput = document.querySelector('.wordbox-rect input') as HTMLInputElement;
            if (existingInput) {
                const rectContainer = existingInput.parentElement as HTMLElement;
                const currentText = existingInput.value.trim();
                const originalText = rectContainer.dataset.originalText || '';
                rectContainer.textContent = currentText || originalText;
                
                // Remove the measure span if it exists
                const measureSpan = document.querySelector('span[style*="visibility: hidden"]');
                if (measureSpan) {
                    measureSpan.remove();
                }
            }
            
            // Check if this box has any available circles
            const topCircle = this.currentlyHighlightedBox!.querySelector('.wordbox-circle-top');
            const bottomCircle = this.currentlyHighlightedBox!.querySelector('.wordbox-circle-bottom');
            
            // If no circles are available, do nothing
            if (!topCircle && !bottomCircle) return;
            
            // Get all currently connected boxes before creating new child
            const existingConnectedBoxes = this.getAllConnectedBoxes(wordBox);

            // Calculate position for child box
            const parentRect = wordBox.getElement().getBoundingClientRect();
            const pageContainer = wordBox.getElement().closest('.canvas-container') as HTMLElement;
            if (!pageContainer) return;
            
            const canvas = pageContainer.querySelector('canvas');
            if (!canvas) return;
            
            const canvasRect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / canvasRect.width;
            const scaleY = canvas.height / canvasRect.height;
            
            // Position the child box centered with parent, using current left position
            const parentLeft = parseFloat(wordBox.getElement().style.left);
            const x = parentLeft; // Use parent's left position directly
            
            // Determine if this is a top or bottom child based on available circles
            // If both circles exist, create a bottom child by default
            // If only top circle exists, create a top child
            const isTopChild = !!topCircle && !bottomCircle;
            
            // Check if there's already a child in this direction
            if ((isTopChild && wordBox.getChildBoxIdTop()) || (!isTopChild && wordBox.getChildBoxIdBottom())) {
                return; // Don't create siblings
            }
            
            const y = isTopChild ? 
                (parentRect.top - canvasRect.top - CAP_HEIGHT - WordBox.verticalSpacing) * scaleY : // Use dynamic spacing
                (parentRect.bottom - canvasRect.top + WordBox.verticalSpacing) * scaleY; // Use dynamic spacing
            
            // Get suggested translation if available
            const translations = wordBox.getTranslationsForWord();
            const initialText = translations && translations.length > 0 ? translations[0] : 'New Word';

            const childBox = new WordBox(x, y, initialText, '', isTopChild, !isTopChild);
            
            // Set the highlighted node as the parent
            childBox.setParentId(wordBox.getId());
            
            // Update the parent's child references and remove the corresponding circle
            if (isTopChild) {
                wordBox.setChildBoxIdTop(childBox.getId());
                if (topCircle) topCircle.remove(); // Remove the top circle since it's being replaced by a child
            } else {
                wordBox.setChildBoxIdBottom(childBox.getId());
                if (bottomCircle) bottomCircle.remove(); // Remove the bottom circle since it's being replaced by a child
            }
            
            pageContainer.appendChild(childBox.getElement());

            // Record add operation for the child box
            if (this.historyManager) {
                this.historyManager.addOperation(
                    this.historyManager.createAddBoxOperation(childBox, pageContainer)
                );
            }

            // Immediately update the child position to ensure proper alignment
            this.updateChildBoxPosition(wordBox);
            
            // Check if topmost ancestor is near a line
            const pageNumber = parseInt(pageContainer.dataset.pageNumber || '1');
            const lines = this.getTextLines(pageNumber) || [];
            
            // Find the closest line to the topmost ancestor
            let minDistance = Infinity;
            let closestLine: TextLine | null = null;
            
            // Find the topmost ancestor for line snapping
            let topmostAncestor = wordBox;
            let currentBox = wordBox;
            while (currentBox.getParentId()) {
                const ancestorBox = WordBox.fromElement(document.getElementById(currentBox.getParentId()!));
                if (ancestorBox) {
                    topmostAncestor = ancestorBox;
                    currentBox = ancestorBox;
                } else {
                    break;
                }
            }
            
            const topmostRect = topmostAncestor.getElement().getBoundingClientRect();
            const topmostCenter = topmostRect.top + (topmostRect.height / 2) - canvasRect.top;
            
            for (const line of lines) {
                const lineY = line.getYPosition();
                const lineScreenY = lineY / scaleY;
                const lineCenter = lineScreenY - CAP_HEIGHT;
                
                const distance = Math.abs(topmostCenter - lineCenter);
                
                if (distance < minDistance && distance < 25) {
                    minDistance = distance;
                    closestLine = line;
                }
            }

            // If topmost ancestor is near a line, snap it and all its descendants to the line
            if (closestLine) {
                const lineY = closestLine.getYPosition();
                const lineScreenY = lineY / scaleY;
                const lineCenter = lineScreenY - CAP_HEIGHT;
                
                // Calculate snap position relative to the container
                const snapY = lineCenter - (topmostRect.height / 2) + ASCENDER_HEIGHT - 16;
                topmostAncestor.getElement().style.top = `${snapY}px`;

                // Add the topmost ancestor to the line (this will handle all descendants)
                closestLine.addWordBox(topmostAncestor);
                
                // Update positions of all descendants
                this.updateChildBoxPosition(topmostAncestor);
            }
            
            // Clear all selection states
            WordBox.instances.forEach(box => {
                box.setSelected(false);
                box.setIndividuallySelected(false);
            });
            
            // Select all previously connected boxes as a group
            existingConnectedBoxes.forEach(box => box.setSelected(true));
            
            // Select the new child box as a group member and individually
            childBox.setSelected(true);
            childBox.setIndividuallySelected(true);
            
            // Update currently highlighted box
            this.currentlyHighlightedBox = childBox.getElement();
            
            // Start editing the new child box
            const rectContainer = childBox.getElement().querySelector('.wordbox-rect') as HTMLElement;
            if (rectContainer) {
                const measureSpan = document.createElement('span');
                measureSpan.style.visibility = 'hidden';
                measureSpan.style.position = 'absolute';
                measureSpan.style.whiteSpace = 'pre';
                document.body.appendChild(measureSpan);
                this.createAndSetupInput(rectContainer, childBox.getElement(), measureSpan, initialText);
            }
        } else if (e.key === 'e') {
            // Edit functionality specifically for the 'e' key
            e.preventDefault();
            const rectContainer = this.currentlyHighlightedBox!.querySelector('.wordbox-rect') as HTMLElement;
            if (rectContainer) {
                const measureSpan = document.createElement('span');
                measureSpan.style.visibility = 'hidden';
                measureSpan.style.position = 'absolute';
                measureSpan.style.whiteSpace = 'pre';
                document.body.appendChild(measureSpan);
                this.createAndSetupInput(rectContainer, this.currentlyHighlightedBox!, measureSpan, rectContainer.textContent || '');
            }
        }
    }

    private handleDoubleClick(e: MouseEvent) {
        const target = e.target as HTMLElement;
        
        // First, remove any existing input field and save its content
        const existingInput = document.querySelector('.wordbox-rect input') as HTMLInputElement;
        if (existingInput) {
            const rectContainer = existingInput.parentElement as HTMLElement;
            const currentText = existingInput.value.trim();
            const originalText = rectContainer.dataset.originalText || '';
            rectContainer.textContent = currentText || originalText;
            
            // Remove the measure span if it exists
            const measureSpan = document.querySelector('span[style*="visibility: hidden"]');
            if (measureSpan) {
                measureSpan.remove();
            }
        }
        
        // Check if we clicked on a circle
        if (target.classList.contains('wordbox-circle-bottom') || target.classList.contains('wordbox-circle-top')) {
            const parentBoxEl = target.closest('[id^="wordbox-"]') as HTMLElement;
            if (!parentBoxEl) return;

            const parentBox = WordBox.fromElement(parentBoxEl);
            if (!parentBox) return;

            // Get all currently connected boxes before creating new child
            const existingConnectedBoxes = this.getAllConnectedBoxes(parentBox);

            // Find the topmost ancestor
            let topmostAncestor = parentBox;
            let currentBox = parentBox;
            while (currentBox.getParentId()) {
                const ancestorBox = WordBox.fromElement(document.getElementById(currentBox.getParentId()!));
                if (ancestorBox) {
                    topmostAncestor = ancestorBox;
                    currentBox = ancestorBox;
                } else {
                    break;
                }
            }

            // Calculate position for child box
            const parentRect = parentBox.getElement().getBoundingClientRect();
            const pageContainer = parentBox.getElement().closest('.canvas-container') as HTMLElement;
            if (!pageContainer) return;
            
            const canvas = pageContainer.querySelector('canvas');
            if (!canvas) return;
            
            const canvasRect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / canvasRect.width;
            const scaleY = canvas.height / canvasRect.height;
            
            // Position the child box centered with parent, using current left position
            const parentLeft = parseFloat(parentBox.getElement().style.left);
            const x = parentLeft; // Use parent's left position directly
            
            // Determine if creating above or below based on which circle was clicked
            const isTop = target.classList.contains('wordbox-circle-top');
            const y = isTop ? 
                (parentRect.top - canvasRect.top - CAP_HEIGHT - WordBox.verticalSpacing) * scaleY : // Use dynamic spacing
                (parentRect.bottom - canvasRect.top + WordBox.verticalSpacing) * scaleY; // Use dynamic spacing
            
            // Get suggested translation if available
            const translations = parentBox.getTranslationsForWord();
            const initialText = translations && translations.length > 0 ? translations[0] : 'New Word';
            
            // Create the child box, passing isTop to indicate if it's a top child
            const childBox = new WordBox(x, y, initialText, '', isTop, !isTop);
            childBox.setParentId(parentBox.getId());
            
            // Remove the clicked circle
            target.remove();
            
            // Set appropriate child box ID based on position
            if (isTop) {
                parentBox.setChildBoxIdTop(childBox.getId());
            } else {
                parentBox.setChildBoxIdBottom(childBox.getId());
            }
            
            pageContainer.appendChild(childBox.getElement());

            // Record add operation for the child box
            if (this.historyManager) {
                this.historyManager.addOperation(
                    this.historyManager.createAddBoxOperation(childBox, pageContainer)
                );
            }
            
            // Immediately update the child position to ensure proper alignment
            this.updateChildBoxPosition(parentBox);
            
            // Check if topmost ancestor is near a line
            const pageNumber = parseInt(pageContainer.dataset.pageNumber || '1');
            const lines = this.getTextLines(pageNumber) || [];
            
            // Find the closest line to the topmost ancestor
            let minDistance = Infinity;
            let closestLine: TextLine | null = null;
            
            const topmostRect = topmostAncestor.getElement().getBoundingClientRect();
            const topmostCenter = topmostRect.top + (topmostRect.height / 2) - canvasRect.top;
            
            for (const line of lines) {
                const lineY = line.getYPosition();
                const lineScreenY = lineY / scaleY;
                const lineCenter = lineScreenY - CAP_HEIGHT;
                
                const distance = Math.abs(topmostCenter - lineCenter);
                
                if (distance < minDistance && distance < 25) {
                    minDistance = distance;
                    closestLine = line;
                }
            }

            // If topmost ancestor is near a line, snap it and all its descendants to the line
            if (closestLine) {
                const lineY = closestLine.getYPosition();
                const lineScreenY = lineY / scaleY;
                const lineCenter = lineScreenY - CAP_HEIGHT;
                
                // Calculate snap position relative to the container
                const snapY = lineCenter - (topmostRect.height / 2) + ASCENDER_HEIGHT - 16;
                topmostAncestor.getElement().style.top = `${snapY}px`;

                // Add the topmost ancestor to the line (this will handle all descendants)
                closestLine.addWordBox(topmostAncestor);
                
                // Update positions of all descendants
                this.updateChildBoxPosition(topmostAncestor);
            }
            
            // Clear all selection states
            WordBox.instances.forEach(box => {
                box.setSelected(false);
                box.setIndividuallySelected(false);
            });
            
            // Select all previously connected boxes as a group
            existingConnectedBoxes.forEach(box => box.setSelected(true));
            
            // Select the new child box as a group member and individually
            childBox.setSelected(true);
            childBox.setIndividuallySelected(true);
            
            // Update currently highlighted box
            this.currentlyHighlightedBox = childBox.getElement();
            
            // Clear any circle highlighting since we just created a child box
            if (this.currentlyHighlightedCircle) {
                this.currentlyHighlightedCircle.classList.remove('highlighted');
                this.currentlyHighlightedCircle = null;
            }
            
            // Start editing the new child box
            const rectContainer = childBox.getElement().querySelector('.wordbox-rect') as HTMLElement;
            if (rectContainer) {
                const measureSpan = document.createElement('span');
                measureSpan.style.visibility = 'hidden';
                measureSpan.style.position = 'absolute';
                measureSpan.style.whiteSpace = 'pre';
                document.body.appendChild(measureSpan);
                this.createAndSetupInput(rectContainer, childBox.getElement(), measureSpan, initialText);
            }
            
            // Prevent the click from triggering other handlers
            e.stopPropagation();
            return;
        }
        
        // Handle regular word box double-click for text editing
        const wordBoxEl = target.closest('[id^="wordbox-"]') as HTMLElement;
        if (!wordBoxEl) return;

        const wordBox = WordBox.fromElement(wordBoxEl);
        if (!wordBox) return;

        const rectContainer = wordBoxEl.querySelector('.wordbox-rect') as HTMLElement;
        if (rectContainer) {
            // Create a hidden span to measure text width
            const measureSpan = document.createElement('span');
            measureSpan.style.visibility = 'hidden';
            measureSpan.style.position = 'absolute';
            measureSpan.style.whiteSpace = 'pre';
            document.body.appendChild(measureSpan);

            // Create and setup the input field
            this.createAndSetupInput(rectContainer, wordBoxEl, measureSpan, rectContainer.textContent || '');
            
            // Prevent the click from triggering other handlers
            e.stopPropagation();
        }
    }

    private handleClick(e: MouseEvent) {
        // Don't handle selection if we were just dragging
        if (this.globalIsDragging) {
            this.globalIsDragging = false;
            return;
        }

        const target = e.target as HTMLElement;
        
        // Check if we clicked on a sidebar
        const isSidebar = target.closest('#right-sidebar') || target.closest('#sidebar');
        if (isSidebar) {
            // Don't handle clicks on the sidebar
            return;
        }
        
        // Find and focus the canvas container without scrolling
        const canvasContainer = target.closest('.canvas-container') as HTMLElement;
        if (canvasContainer) {
            // Prevent scrolling when focusing
            const scrollPosition = window.scrollY;
            canvasContainer.focus({ preventScroll: true });
            // Ensure scroll position stays the same
            window.scrollTo(0, scrollPosition);
        }
        
        // Check if we clicked on a circle
        if (target.classList.contains('wordbox-circle-bottom') || target.classList.contains('wordbox-circle-top')) {
            // Clear any existing circle highlights
            document.querySelectorAll('.wordbox-circle-bottom.highlighted, .wordbox-circle-top.highlighted').forEach(circle => {
                circle.classList.remove('highlighted');
            });
            
            // Highlight the clicked circle
            target.classList.add('highlighted');
            this.currentlyHighlightedCircle = target;
            
            // Get the parent box of the circle
            const parentBoxEl = target.closest('[id^="wordbox-"]') as HTMLElement;
            if (parentBoxEl) {
                const parentBox = WordBox.fromElement(parentBoxEl);
                if (parentBox) {
                    // Clear previous box selections (visual only, don't modify line connections)
                    WordBox.instances.forEach(box => {
                        box.setSelected(false);
                        box.setIndividuallySelected(false);
                    });

                    // Select all connected boxes as a group
                    const connectedBoxes = this.getAllConnectedBoxes(parentBox);
                    connectedBoxes.forEach(box => box.setSelected(true));
                }
            }
            
            // Clear individual box highlight but maintain group selection
            this.currentlyHighlightedBox = null;
            
            return;
        }
        
        // If we clicked anywhere else, clear circle highlighting
        if (this.currentlyHighlightedCircle) {
            this.currentlyHighlightedCircle.classList.remove('highlighted');
            this.currentlyHighlightedCircle = null;
        }

        const clickedWordBox = target.closest('[id^="wordbox-"]');
        
        // Clear visual selection states WITHOUT removing line connections
        WordBox.instances.forEach(box => {
            box.setSelected(false);
            box.setIndividuallySelected(false);
        });
        this.currentlyHighlightedBox = null;
        
        // Clear lexicon info if no wordbox is clicked
        const updateLexiconInfo = (window as any).updateLexiconInfo;
        if (typeof updateLexiconInfo === 'function' && !clickedWordBox) {
            updateLexiconInfo(null);
        }
        
        // If we clicked on a word box
        if (clickedWordBox) {
            const wordBox = WordBox.fromElement(clickedWordBox as HTMLElement);
            if (wordBox) {
                // Get all connected boxes and select them as a group (just visual selection)
                const connectedBoxes = this.getAllConnectedBoxes(wordBox);
                connectedBoxes.forEach(box => box.setSelected(true));
                
                // Set individual selection on the specifically clicked box
                wordBox.setIndividuallySelected(true);
                
                // Update the currently highlighted box to the clicked one
                this.currentlyHighlightedBox = wordBox.getElement();
                
                // Deselect any selected TextLines in all pages
                if (this.canvasManager) {
                    const textLinesMap = this.canvasManager.getTextLines();
                    textLinesMap.forEach(lines => {
                        lines.forEach(line => {
                            if (line.isSelected()) {
                                line.setSelected(false);
                            }
                        });
                    });
                }
                
                // Update lexicon info with the selected WordBox
                const updateLexiconInfo = (window as any).updateLexiconInfo;
                if (typeof updateLexiconInfo === 'function') {
                    updateLexiconInfo(wordBox);
                }
            }
        }
    }

    private handleMouseDown(e: MouseEvent) {
        const target = e.target as HTMLElement;
        
        // Check for word box drag
        const wordBoxEl = target.closest('[id^="wordbox-"]') as HTMLElement;
        if (wordBoxEl) {
            e.preventDefault();
            this.globalIsDragging = true;
            
            // Get the clicked word box
            const wordBox = WordBox.fromElement(wordBoxEl);
            if (!wordBox) return;

            // Deselect any selected TextLines in all pages BEFORE starting the drag
            if (this.canvasManager) {
                console.log("WordBoxManager.handleMouseDown: Deselecting any selected TextLines");
                const textLinesMap = this.canvasManager.getTextLines();
                textLinesMap.forEach((lines, pageNum) => {
                    lines.forEach(line => {
                        if (line.isSelected()) {
                            console.log(`WordBoxManager.handleMouseDown: Deselecting line on page ${pageNum}`);
                            line.setSelected(false);
                        }
                    });
                });
            }

            // Find the root parent box or use the clicked box if it has no parent
            this.draggedWordBox = wordBox;
            let currentBox = wordBox;
            while (currentBox.getParentId()) {
                const parentBox = WordBox.fromElement(document.getElementById(currentBox.getParentId()!));
                if (parentBox) {
                    this.draggedWordBox = parentBox;
                    currentBox = parentBox;
                } else {
                    break;
                }
            }

            // Store initial position for move operation
            this.dragStartX = e.clientX;
            this.dragStartY = e.clientY;
            this.initialWordBoxX = parseInt(this.draggedWordBox.getElement().style.left);
            this.initialWordBoxY = parseInt(this.draggedWordBox.getElement().style.top);

            // Store initial line ID before any dragging
            const initialLineId = this.draggedWordBox.getLineId();

            // Get all connected boxes
            const connectedBoxes = this.getAllConnectedBoxes(this.draggedWordBox);
            
            // Store initial state for all connected boxes
            const initialStates = connectedBoxes.map(box => ({
                instance: box,
                lineId: box.getLineId(),
                x: parseInt(box.getElement().style.left),
                y: parseInt(box.getElement().style.top)
            }));
            
            // Store the initial states in the dragged box for use in handleMouseUp
            (this.draggedWordBox as any).initialDragStates = initialStates;

            // Clear visual selection states only
            WordBox.instances.forEach(box => {
                box.setSelected(false);
                box.setIndividuallySelected(false);
            });
            
            // Select all connected boxes as a group (visual selection only)
            connectedBoxes.forEach(box => box.setSelected(true));
            
            // Set individual selection on the specifically clicked box
            wordBox.setIndividuallySelected(true);
            
            // Check if we're actually dragging the WordBox itself (not just clicking to select)
            // We'll keep track of this and only remove from the line if the user starts moving the mouse
            (this.draggedWordBox as any).potentialDrag = true;
            (this.draggedWordBox as any).initialLineId = initialLineId;
            
            // Set cursor style for all connected boxes
            connectedBoxes.forEach(box => box.getElement().style.cursor = 'grabbing');
        }
    }

    private handleMouseMove(e: MouseEvent) {
        // Handle word box dragging
        if (this.draggedWordBox && this.globalIsDragging) {
            const deltaX = e.clientX - this.dragStartX;
            const deltaY = e.clientY - this.dragStartY;
            
            // Check if user actually started dragging the WordBox
            // (as opposed to just clicking it for selection)
            if ((this.draggedWordBox as any).potentialDrag) {
                // If the user has moved the mouse more than a threshold, consider it a true drag
                const dragThreshold = 3; // pixels
                if (Math.abs(deltaX) > dragThreshold || Math.abs(deltaY) > dragThreshold) {
                    // Store the initial line ID for later tracking
                    // But don't remove it from the line yet - we'll decide that based on
                    // vertical movement later
                    const initialLineId = (this.draggedWordBox as any).initialLineId;
                    
                    // Store a reference to the line
                    if (initialLineId) {
                        const pageNumber = parseInt(initialLineId.split('-')[1]);
                        const lines = this.getTextLines(pageNumber) || [];
                        const currentLine = lines.find(line => line.getId() === initialLineId);
                        if (currentLine) {
                            // Save a reference to the line, but don't remove yet
                            (this.draggedWordBox as any).initialLine = currentLine;
                            
                            // Store initial Y position of the line
                            (this.draggedWordBox as any).initialLineY = currentLine.getYPosition();
                        }
                    }
                    
                    // Mark that we've processed the potential drag
                    (this.draggedWordBox as any).potentialDrag = false;
                }
            }
            
            // Get all connected boxes
            const connectedBoxes = this.getAllConnectedBoxes(this.draggedWordBox);
            
            // Get the main box's element
            const element = this.draggedWordBox.getElement();
            
            // Calculate new position
            const newX = this.initialWordBoxX + deltaX;
            let newY = this.initialWordBoxY + deltaY;
            
            // Check if we need to detach from the line based on vertical movement
            const initialLine = (this.draggedWordBox as any).initialLine;
            if (initialLine) {
                const initialLineY = (this.draggedWordBox as any).initialLineY;
                if (initialLineY) {
                    // Calculate how far vertically the box has moved from its line
                    const verticalDistanceFromLine = Math.abs(newY - initialLineY + CAP_HEIGHT);
                    const detachThreshold = 30; // Pixels to move vertically before detaching
                    
                    if (verticalDistanceFromLine > detachThreshold) {
                        // Only detach if we've moved vertically beyond the threshold
                        initialLine.removeWordBox(this.draggedWordBox);
                        
                        // Clear the line reference so we don't check again
                        (this.draggedWordBox as any).initialLine = null;
                    }
                }
            }

            // Get page container and margins
            const pageContainer = element.closest('.canvas-container') as HTMLElement;
            const canvas = pageContainer?.querySelector('canvas');
            const margins = canvas ? this.canvasManager?.getGlobalMargins() : null;
            const rect = element.querySelector('.wordbox-rect') as HTMLElement;
            const boxWidth = rect ? rect.getBoundingClientRect().width : 0;
            const boxHeight = rect ? rect.getBoundingClientRect().height : 0;

            // If this is a headline, always restrict movement to stay within margins
            if (this.draggedWordBox.getElement().classList.contains('headline')) {
                if (pageContainer && canvas && margins) {
                    // Ensure the headline stays above top margin
                    const maxY = margins.top - CAP_HEIGHT;
                    newY = Math.min(newY, maxY);

                    // Ensure the headline stays between left and right margins
                    const minX = margins.left + 3; // Same offset as initial placement
                    const maxX = margins.right - boxWidth - 3; // Leave same margin on right
                    const clampedX = Math.max(minX, Math.min(maxX, newX));
                    this.draggedWordBox.setX(clampedX);
                    this.draggedWordBox.setY(newY);
                    return; // Skip the normal position update
                }
            }
            
            // Check if Shift key is held down - if so, restrict all WordBoxes to page margins
            // Also restrict Chapter and Section boxes to page margins regardless of Shift key
            if ((e.shiftKey || this.draggedWordBox.getIsChapter() || this.draggedWordBox.getIsSection()) && 
                pageContainer && canvas && margins) {
                // Calculate clamped position to keep box within margins
                const minX = margins.left + 3;
                const maxX = margins.right - boxWidth - 3;
                const minY = margins.top;
                const maxY = margins.bottom - boxHeight;
                
                const clampedX = Math.max(minX, Math.min(maxX, newX));
                const clampedY = Math.max(minY, Math.min(maxY, newY));
                
                // When Shift is pressed, also check for collisions with other WordBoxes
                if (e.shiftKey) {
                    // Add debug logs
                    console.log("Checking for collisions...");
                    console.log(`Box dimensions: ${boxWidth} x ${boxHeight}`);
                    
                    // Get all connected boxes (parent and all children)
                    const connectedBoxes = this.getAllConnectedBoxes(this.draggedWordBox);
                    console.log(`Found ${connectedBoxes.length} connected boxes`);
                    
                    // Save original positions of all connected boxes
                    const originalPositions = connectedBoxes.map(box => {
                        const el = box.getElement();
                        return {
                            box,
                            left: parseFloat(el.style.left),
                            top: parseFloat(el.style.top)
                        };
                    });
                    
                    // Calculate how much to move the main box
                    const moveX = clampedX - parseFloat(element.style.left);
                    const moveY = clampedY - parseFloat(element.style.top);
                    
                    // Temporarily move all connected boxes by the same amount
                    originalPositions.forEach(item => {
                        const el = item.box.getElement();
                        el.style.left = `${item.left + moveX}px`;
                        el.style.top = `${item.top + moveY}px`;
                    });
                    
                    // Calculate a combined bounding rect for all connected boxes
                    let combinedRect: DOMRect | null = null;
                    
                    connectedBoxes.forEach(box => {
                        const boxRect = box.getElement().getBoundingClientRect();
                        
                        if (!combinedRect) {
                            combinedRect = boxRect;
                        } else {
                            // Expand the combined rectangle to include this box
                            const left = Math.min(combinedRect.left, boxRect.left);
                            const top = Math.min(combinedRect.top, boxRect.top);
                            const right = Math.max(combinedRect.right, boxRect.right);
                            const bottom = Math.max(combinedRect.bottom, boxRect.bottom);
                            
                            combinedRect = new DOMRect(
                                left, 
                                top, 
                                right - left, 
                                bottom - top
                            );
                        }
                    });
                    
                    const testRect = combinedRect || element.getBoundingClientRect();
                    
                    // Move all boxes back to their original positions
                    originalPositions.forEach(item => {
                        const el = item.box.getElement();
                        el.style.left = `${item.left}px`;
                        el.style.top = `${item.top}px`;
                    });
                    
                    // No debug visualization needed
                    
                    // Force a reflow to ensure the elements are rendered at their original positions
                    void element.offsetWidth;
                    
                    // Check if there would be a collision
                    const collidingBox = this.findCollidingWordBox(this.draggedWordBox, pageContainer, testRect);
                    
                    if (collidingBox) {
                        // If there's a collision, don't update the position (prevent movement)
                        // We'll keep the last valid position
                        return;
                    }
                    
                    // No visual feedback
                }
                
                // Update position with clamped values
                this.draggedWordBox.setX(clampedX);
                this.draggedWordBox.setY(clampedY);
            } else {
                // Normal update without clamping
                this.draggedWordBox.setX(newX);
                this.draggedWordBox.setY(newY);
                element.classList.remove('shift-constrained');
            }
            
            // Update positions of all child boxes, passing the parent's left position and shift key state
            const parentLeft = this.draggedWordBox.getX();
            this.updateChildBoxPosition(this.draggedWordBox, parentLeft, e.shiftKey);
            
            // Find the page the word box is currently over
            let targetPage: Element | null = null;
            const pages = document.querySelectorAll('.canvas-container');
            
            // Get the WordBox position to also check where the box is, not just the cursor
            const wordBoxEl = this.draggedWordBox.getElement();
            const wordBoxRect = wordBoxEl.getBoundingClientRect();
            const wordBoxCenterY = wordBoxRect.top + (wordBoxRect.height / 2);
            
            pages.forEach(page => {
                const rect = page.getBoundingClientRect();
                if ((e.clientY >= rect.top && e.clientY <= rect.bottom) ||
                    (wordBoxCenterY >= rect.top && wordBoxCenterY <= rect.bottom)) {
                    targetPage = page;
                }
            });
            
            if (targetPage) {
                const pageEl = targetPage as HTMLElement;
                const canvas = pageEl.querySelector('canvas');
                if (canvas) {
                    const rect = canvas.getBoundingClientRect();
                    const containerRect = pageEl.getBoundingClientRect();
                    const scaleY = canvas.height / rect.height;
                    
                    // Get the page number
                    const pageNumber = parseInt(pageEl.dataset.pageNumber || '1');
                    
                    // Get all lines on this page
                    const lines = (this.getTextLines(pageNumber) || []) as TextLine[];
                    
                    // Find the closest line, with improved snap stickiness
                    let minDistance = Infinity;
                    this.closestLine = null;
                    
                    const wordboxRect = element.getBoundingClientRect();
                    const wordboxCenter = wordboxRect.top + (wordboxRect.height / 2) - containerRect.top;
                    
                    // If we're already snapped to a line, check if we should stay snapped
                    if (this.snapLineId) {
                        const snapLine = lines.find(line => line.getId() === this.snapLineId);
                        if (snapLine) {
                            const lineY = snapLine.getYPosition();
                            const lineScreenY = lineY / scaleY;
                            const lineCenter = lineScreenY - CAP_HEIGHT;
                            const distance = Math.abs(wordboxCenter - lineCenter);
                            
                            if (distance <= this.snapReleaseDistance) {
                                // Stay snapped to current line
                                this.closestLine = snapLine;
                                // Add visual feedback
                                element.classList.add('near-line');
                                // Skip looking for other lines
                                minDistance = distance;
                            } else {
                                // Release snap if moved too far
                                this.snapLineId = null;
                                element.classList.remove('near-line');
                            }
                        } else {
                            // Line no longer exists
                            this.snapLineId = null;
                            element.classList.remove('near-line');
                        }
                    }
                    
                    // If not already snapped to a line, search for closest line
                    if (!this.snapLineId) {
                        for (const line of lines) {
                            const lineY = line.getYPosition();
                            const lineScreenY = lineY / scaleY;
                            const lineCenter = lineScreenY - CAP_HEIGHT;
                            
                            const distance = Math.abs(wordboxCenter - lineCenter);
                            
                            if (distance < minDistance && distance < this.snapThreshold) {
                                minDistance = distance;
                                this.closestLine = line;
                                // Add visual feedback when close to a line
                                element.classList.add('near-line');
                            }
                        }
                        
                        // If no line is close enough, remove visual feedback
                        if (!this.closestLine) {
                            element.classList.remove('near-line');
                        }
                    }

                    // If we're near a line, snap to it
                    if (this.closestLine) {
                        // Record the line we're snapped to
                        this.snapLineId = this.closestLine.getId();
                        
                        const lineY = this.closestLine.getYPosition();
                        const lineScreenY = lineY / scaleY;
                        const lineCenter = lineScreenY - CAP_HEIGHT;
                        
                        // Calculate snap position relative to the container
                        const snapY = lineCenter - (wordboxRect.height / 2) + ASCENDER_HEIGHT - 16;
                        element.style.top = `${snapY}px`;

                        // Set preventSnap to false to ensure position update works
                        this.closestLine.setPreventSnap(false);
                        
                        // Add the main box and all its connected boxes to the line
                        this.closestLine.addWordBox(this.draggedWordBox);
                        
                        // Update positions of all child boxes after snapping
                        this.updateChildBoxPosition(this.draggedWordBox);
                        
                        // Add visual feedback
                        element.classList.add('near-line');
                    }
                }
            }
        }
    }

    private handleMouseUp() {
        if (this.draggedWordBox) {
            const element = this.draggedWordBox.getElement();
            element.style.cursor = 'pointer';
            
            interface BoxState {
                instance: WordBox;
                lineId: string | undefined;
                x: number;
                y: number;
            }
            
            // Get the initial states that were stored during mousedown
            const initialStates = (this.draggedWordBox as any).initialDragStates as BoxState[];
            
            // If this was just a click without dragging (potentialDrag is still true),
            // we don't need to record any history operations
            if (!(this.draggedWordBox as any).potentialDrag) {
                // Record move operation if position changed
                if (this.historyManager && initialStates) {
                    // Check if any box moved from its initial position
                    const anyBoxMoved = initialStates.some((state: BoxState) => {
                        const box = state.instance;
                        const element = box.getElement();
                        const currentX = parseInt(element.style.left);
                        const currentY = parseInt(element.style.top);
                        const currentLineId = box.getLineId();
                        
                        return currentX !== state.x || 
                               currentY !== state.y || 
                               currentLineId !== state.lineId;
                    });

                    if (anyBoxMoved) {
                        this.historyManager.addOperation(
                            this.historyManager.createMoveBoxOperation(
                                this.draggedWordBox,
                                this.initialWordBoxX,
                                this.initialWordBoxY,
                                parseInt(element.style.left),
                                parseInt(element.style.top)
                            )
                        );
                    }
                }
            }

            // If the box is not near a line at the end of dragging, ensure it's not associated with any line
            if (!this.closestLine && this.draggedWordBox.getLineId()) {
                // Get the line the box is currently associated with
                const lineId = this.draggedWordBox.getLineId();
                if (lineId) {
                    const pageNumber = parseInt(lineId.split('-')[1]);
                    const lines = this.getTextLines(pageNumber) || [];
                    const currentLine = lines.find(line => line.getId() === lineId);
                    if (currentLine) {
                        // Remove the box from the line
                        currentLine.removeWordBox(this.draggedWordBox);
                    }
                }
            }

            // Remove near-line class
            element.classList.remove('near-line');
            
            // Remove classes from all connected boxes
            const connectedBoxes = this.getAllConnectedBoxes(this.draggedWordBox);
            connectedBoxes.forEach(box => {
                if (box !== this.draggedWordBox) {
                    box.getElement().classList.remove('near-line');
                }
            });
            
            // Remove debug element
            const debugEl = document.getElementById('collision-debug');
            if (debugEl) {
                debugEl.parentElement?.removeChild(debugEl);
            }
            
            // Clean up our tracking properties
            this.draggedWordBox = null;
            this.globalIsDragging = false;
            this.closestLine = null;
            this.snapLineId = null;
        }
    }

    private getAllConnectedBoxes(wordBox: WordBox): WordBox[] {
        const connectedBoxes: WordBox[] = [];
        
        // Function to recursively find connected boxes
        const findConnected = (box: WordBox) => {
            if (connectedBoxes.includes(box)) return;
            
            connectedBoxes.push(box);
            
            // Check for parent
            const parentId = box.getParentId();
            if (parentId) {
                const parentBox = WordBox.fromElement(document.getElementById(parentId));
                if (parentBox) {
                    findConnected(parentBox);
                }
            }
            
            // Check for children
            const childIdBottom = box.getChildBoxIdBottom();
            const childIdTop = box.getChildBoxIdTop();
            
            if (childIdBottom) {
                const childBox = WordBox.fromElement(document.getElementById(childIdBottom));
                if (childBox) {
                    findConnected(childBox);
                }
            }
            
            if (childIdTop) {
                const childBox = WordBox.fromElement(document.getElementById(childIdTop));
                if (childBox) {
                    findConnected(childBox);
                }
            }
        };
        
        findConnected(wordBox);
        return connectedBoxes;
    }

    // Helper method to check if two rectangles overlap
    private checkCollision(rect1: DOMRect, rect2: DOMRect): boolean {
        const collision = !(
            rect1.right < rect2.left ||
            rect1.left > rect2.right ||
            rect1.bottom < rect2.top ||
            rect1.top > rect2.bottom
        );
        
        if (collision) {
            console.log("COLLISION DETAILS:");
            console.log(`  Rect1: (${rect1.left}, ${rect1.top}, ${rect1.right}, ${rect1.bottom})`);
            console.log(`  Rect2: (${rect2.left}, ${rect2.top}, ${rect2.right}, ${rect2.bottom})`);
            console.log(`  Horizontally: ${!(rect1.right < rect2.left || rect1.left > rect2.right)}`);
            console.log(`  Vertically: ${!(rect1.bottom < rect2.top || rect1.top > rect2.bottom)}`);
        }
        
        return collision;
    }
    
    // Helper method to find all other WordBoxes on the page and check for collisions
    private findCollidingWordBox(draggingBox: WordBox, pageContainer: HTMLElement, testRect: DOMRect): WordBox | null {
        // Skip collision with the draggingBox itself and any of its connected boxes (children/parents)
        const connectedBoxes = this.getAllConnectedBoxes(draggingBox);
        const connectedIds = connectedBoxes.map(box => box.getId());
        
        console.log(`Test rect at: (${testRect.left}, ${testRect.top}) size: ${testRect.width}x${testRect.height}`);
        console.log(`Connected boxes to skip: ${connectedIds.join(', ')}`);
        
        // Get all wordboxes on the current page
        const wordBoxElements = Array.from(pageContainer.querySelectorAll('[id^="wordbox-"]'));
        console.log(`Found ${wordBoxElements.length} WordBoxes on page to check for collisions`);
        
        // Check each wordbox for collision
        for (const boxEl of wordBoxElements) {
            const boxId = boxEl.id;
            
            // Skip if this is the box we're dragging or one of its connected boxes
            if (connectedIds.includes(boxId)) {
                continue;
            }
            
            const box = WordBox.fromElement(boxEl as HTMLElement);
            if (!box) continue;
            
            // Get bounding rect
            const boxRect = boxEl.getBoundingClientRect();
            console.log(`Checking box ${boxId} at: (${boxRect.left}, ${boxRect.top}) size: ${boxRect.width}x${boxRect.height}`);
            
            // Check for collision
            const collides = this.checkCollision(testRect, boxRect);
            if (collides) {
                console.log(`COLLISION DETECTED with box ${boxId}!`);
                return box;
            }
        }
        
        console.log("No collisions found");
        return null;
    }
    
    private updateChildBoxPosition(parentBox: WordBox, forcedParentLeft?: number, shiftKeyPressed?: boolean) {
        const parentEl = parentBox.getElement();
        const pageContainer = parentEl.closest('.canvas-container');
        if (!pageContainer) return;

        const canvas = pageContainer.querySelector('canvas');
        if (!canvas) return;

        const containerRect = pageContainer.getBoundingClientRect();
        const margins = this.canvasManager?.getGlobalMargins();
        
        // Function to recursively update child positions
        const updateChildPosition = (box: WordBox, isTop: boolean) => {
            const childEl = box.getElement();
            const parentEl = document.getElementById(box.getParentId()!)!;
            
            // Use forced parent left if provided (during dragging), otherwise use parent's style.left
            const newLeft = forcedParentLeft !== undefined ? 
                forcedParentLeft : 
                parseFloat(parentEl.style.left);
            
            // Calculate vertical position based on parent's position
            const parentTop = parseFloat(parentEl.style.top) || 0;
            const parentHeight = parentEl.getBoundingClientRect().height;
            const newTop = isTop ? 
                parentTop - CAP_HEIGHT - WordBox.verticalSpacing : 
                parentTop + parentHeight + WordBox.verticalSpacing;
            
            // Check if we need to constrain within margins (shift key or Chapter/Section parent)
            if (shiftKeyPressed || parentBox.getIsChapter() || parentBox.getIsSection()) {
                if (margins) {
                    const rect = childEl.querySelector('.wordbox-rect') as HTMLElement;
                    const boxWidth = rect ? rect.getBoundingClientRect().width : 0;
                    const boxHeight = rect ? rect.getBoundingClientRect().height : 0;
                    
                    // Constrain the child within page margins
                    const minX = margins.left + 3;
                    const maxX = margins.right - boxWidth - 3;
                    const minY = margins.top;
                    const maxY = margins.bottom - boxHeight;
                    
                    const clampedLeft = Math.max(minX, Math.min(maxX, newLeft));
                    const clampedTop = Math.max(minY, Math.min(maxY, newTop));
                    
                    // Update child position with clamped values
                    childEl.style.left = `${clampedLeft}px`;
                    childEl.style.top = `${clampedTop}px`;
                } else {
                    // Default behavior if margins can't be determined
                    childEl.style.left = `${newLeft}px`;
                    childEl.style.top = `${newTop}px`;
                }
            } else {
                // Normal update without clamping
                childEl.style.left = `${newLeft}px`;
                childEl.style.top = `${newTop}px`;
            }
            childEl.style.display = 'block'; // Ensure child is visible

            // If parent is attached to a line, attach child to the same line
            const parentLineId = box.getParentId() ? 
                WordBox.fromElement(parentEl)?.getLineId() : 
                undefined;
            
            if (parentLineId) {
                const pageNumber = parseInt(parentLineId.split('-')[1]);
                const lines = this.getTextLines(pageNumber) || [];
                const currentLine = lines.find(line => line.getId() === parentLineId);
                if (currentLine) {
                    box.setLineId(currentLine.getId());
                }
            }

            // Recursively update this child's children, passing the same left position
            if (box.getChildBoxIdTop()) {
                const topChild = WordBox.fromElement(document.getElementById(box.getChildBoxIdTop()!));
                if (topChild) {
                    updateChildPosition(topChild, true);
                }
            }
            if (box.getChildBoxIdBottom()) {
                const bottomChild = WordBox.fromElement(document.getElementById(box.getChildBoxIdBottom()!));
                if (bottomChild) {
                    updateChildPosition(bottomChild, false);
                }
            }
        };

        // Update top child and all its children
        if (parentBox.getChildBoxIdTop()) {
            const topChild = WordBox.fromElement(document.getElementById(parentBox.getChildBoxIdTop()!));
            if (topChild) {
                updateChildPosition(topChild, true);
            }
        }
        
        // Update bottom child and all its children
        if (parentBox.getChildBoxIdBottom()) {
            const bottomChild = WordBox.fromElement(document.getElementById(parentBox.getChildBoxIdBottom()!));
            if (bottomChild) {
                updateChildPosition(bottomChild, false);
            }
        }
    }

    private getTextLines(pageNumber: number): TextLine[] | undefined {
        if (!this.canvasManager) return undefined;
        return this.canvasManager.getTextLines().get(pageNumber);
    }

    // Public method to start editing a word box
    public startEditingWordBox(wordBoxEl: HTMLElement) {
        const rectContainer = wordBoxEl.querySelector('.wordbox-rect') as HTMLElement;
        if (rectContainer) {
            const measureSpan = document.createElement('span');
            measureSpan.style.visibility = 'hidden';
            measureSpan.style.position = 'absolute';
            measureSpan.style.whiteSpace = 'pre';
            document.body.appendChild(measureSpan);
            this.createAndSetupInput(rectContainer, wordBoxEl, measureSpan, rectContainer.textContent || '');
        }
    }
    
    // Public method to clear all WordBox selections and highlighted elements
    public clearSelection() {
        // Clear current highlighted box and circle
        this.currentlyHighlightedBox = null;
        
        if (this.currentlyHighlightedCircle) {
            this.currentlyHighlightedCircle.classList.remove('highlighted');
            this.currentlyHighlightedCircle = null;
        }
    }

    private snapUnattachedBoxesToLines(pageContainer: HTMLElement) {
        const canvas = pageContainer.querySelector('canvas');
        if (!canvas) return;

        const canvasRect = canvas.getBoundingClientRect();
        const containerRect = pageContainer.getBoundingClientRect();
        const scaleY = canvas.height / canvasRect.height;
        
        // Get all wordboxes in the container
        const wordBoxElements = pageContainer.querySelectorAll('[id^="wordbox-"]');
        const pageNumber = parseInt(pageContainer.dataset.pageNumber || '1');
        const lines = this.getTextLines(pageNumber) || [];

        wordBoxElements.forEach(boxEl => {
            const box = WordBox.fromElement(boxEl as HTMLElement);
            if (!box) return;

            // Skip if box already has a line
            if (box.getLineId()) return;

            // Find the closest line
            let minDistance = Infinity;
            let closestLine: TextLine | null = null;
            
            const boxRect = boxEl.getBoundingClientRect();
            const boxCenter = boxRect.top + (boxRect.height / 2) - containerRect.top;
            
            for (const line of lines) {
                const lineY = line.getYPosition();
                const lineScreenY = lineY / scaleY;
                const lineCenter = lineScreenY - CAP_HEIGHT;
                
                const distance = Math.abs(boxCenter - lineCenter);
                
                if (distance < minDistance && distance < 25) {
                    minDistance = distance;
                    closestLine = line;
                }
            }

            // If we found a close line, snap to it
            if (closestLine) {
                const lineY = closestLine.getYPosition();
                const lineScreenY = lineY / scaleY;
                const lineCenter = lineScreenY - CAP_HEIGHT;
                
                // Calculate snap position relative to the container
                const snapY = lineCenter - (boxRect.height / 2) + ASCENDER_HEIGHT - 16;
                box.setY(snapY);

                // Add the box to the line
                closestLine.addWordBox(box);
            }
        });
    }

    private snapBoxesAfterEdit(editedBox: WordBox) {
        const pageContainer = editedBox.getElement().closest('.canvas-container') as HTMLElement;
        if (!pageContainer) return;

        // Check for and snap any unattached boxes
        this.snapUnattachedBoxesToLines(pageContainer);
    }
    
    /**
     * Public method for creating a child box from a parent WordBox
     * Used by the language dropdown to create a new child when translating a parent box
     */
    public createChildBox(parentBox: WordBox, direction: string = 'bottom', initialText: string = 'New Word'): WordBox | null {
        if (!parentBox) return null;
        
        // Check if this box has available space for a child in the specified direction
        const isTopDirection = direction === 'top';
        const hasAvailableSpace = isTopDirection ? 
            !parentBox.getChildBoxIdTop() : 
            !parentBox.getChildBoxIdBottom();
            
        if (!hasAvailableSpace) {
            console.warn(`Parent box already has a ${direction} child`);
            return null;
        }
        
        // Calculate position for the child box
        const parentEl = parentBox.getElement();
        const parentRect = parentEl.getBoundingClientRect();
        const pageContainer = parentEl.closest('.canvas-container') as HTMLElement;
        if (!pageContainer) return null;
        
        const canvas = pageContainer.querySelector('canvas');
        if (!canvas) return null;
        
        const canvasRect = canvas.getBoundingClientRect();
        const scaleY = canvas.height / canvasRect.height;
        
        // Position the child box centered with parent, using current left position
        const parentLeft = parseFloat(parentEl.style.left);
        const x = parentLeft; // Use parent's left position directly
        
        const y = isTopDirection ? 
            (parentRect.top - canvasRect.top - CAP_HEIGHT - WordBox.verticalSpacing) * scaleY : // Use dynamic spacing
            (parentRect.bottom - canvasRect.top + WordBox.verticalSpacing) * scaleY; // Use dynamic spacing
        
        // Create the child box
        const childBox = new WordBox(x, y, initialText, '', isTopDirection, !isTopDirection);
        childBox.setParentId(parentBox.getId());
        
        // Update the parent's child references
        if (isTopDirection) {
            parentBox.setChildBoxIdTop(childBox.getId());
        } else {
            parentBox.setChildBoxIdBottom(childBox.getId());
        }
        
        // Add the child box to the page
        pageContainer.appendChild(childBox.getElement());
        
        // Record add operation for the child box
        if (this.historyManager) {
            this.historyManager.addOperation(
                this.historyManager.createAddBoxOperation(childBox, pageContainer)
            );
        }
        
        // Remove the circle that would be in this position
        const circle = isTopDirection ? 
            parentEl.querySelector('.wordbox-circle-top') : 
            parentEl.querySelector('.wordbox-circle-bottom');
            
        if (circle) {
            circle.remove();
        }
        
        // Update child position to ensure proper alignment
        this.updateChildBoxPosition(parentBox);
        
        // Check if parent is near a line and snap
        const pageNumber = parseInt(pageContainer.dataset.pageNumber || '1');
        const lines = this.getTextLines(pageNumber) || [];
        
        // Find the closest line to the parent
        const parentCenter = parentRect.top + (parentRect.height / 2) - canvasRect.top;
        let minDistance = Infinity;
        let closestLine: TextLine | null = null;
        
        for (const line of lines) {
            const lineY = line.getYPosition();
            const lineScreenY = lineY / scaleY;
            const lineCenter = lineScreenY - CAP_HEIGHT;
            
            const distance = Math.abs(parentCenter - lineCenter);
            
            if (distance < minDistance && distance < 25) {
                minDistance = distance;
                closestLine = line;
            }
        }
        
        // If parent is near a line, snap it and all descendants
        if (closestLine) {
            closestLine.addWordBox(parentBox);
        }
        
        return childBox;
    }
}