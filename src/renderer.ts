import { getAllConnectedBoxes, WordBox, updateChildBoxPosition } from './wordbox.js';
import {
    DPI,
    PAGE_WIDTH,
    PAGE_HEIGHT,
    PAGE_MARGIN,
    PAGE_GAP,
    CAP_HEIGHT,
    BODY_HEIGHT,
    DESCENDER_HEIGHT,
    ASCENDER_HEIGHT
} from './constants.js';

import { TextLine } from './textline.js';
import { MarginState, DocumentState, PageState, LineState, WordBoxState } from './interfaces.js';
import { CanvasManager } from './canvas-manager.js';
import { WordBoxManager } from './word-box-manager.js';
import { Marginalia } from './marginalia.js';
import { HistoryManager } from './history-manager.js';
import { Lexicon } from './lexicon.js';

declare global {
    interface Window {
        electronAPI: {
            saveDocument: (documentData: string, documentName?: string) => Promise<boolean>;
            openDocument: () => Promise<{ data: string; filePath: string } | null>;
            exportPdf: (documentData: string, defaultName?: string) => Promise<boolean>;
            exportLatex: (documentData: string, defaultName?: string) => Promise<boolean>;
            exportLexicon: (lexiconData: object, defaultName?: string) => Promise<boolean>;
            getLastSavedPath: () => Promise<string | null>;
            onMenuNew: (callback: () => void) => void;
            onMenuOpen: (callback: () => void) => void;
            onMenuSave: (callback: () => void) => void;
            onMenuExportPdf: (callback: () => void) => void;
            onMenuExportLatex: (callback: () => void) => void;
            onMenuExportLexicon: (callback: () => void) => void;
        }
        historyManager: HistoryManager;
    }
}

// Initialize managers
const canvasManager = new CanvasManager();
const wordBoxManager = new WordBoxManager();
const historyManager = new HistoryManager(canvasManager, updateModifiedState);
canvasManager.setHistoryManager(historyManager);
wordBoxManager.setCanvasManager(canvasManager);
wordBoxManager.setHistoryManager(historyManager);

// Make historyManager available globally
window.historyManager = historyManager;

// Current page parameters (can be changed by user)
let currentDPI = DPI;
let currentPageWidth = PAGE_WIDTH;
let currentPageHeight = PAGE_HEIGHT;

let globalMargins: MarginState = canvasManager.getGlobalMargins();

// Margin drag state
let isDraggingMargin = false;
let activeMarginLine: HTMLElement | null = null;
let initialDragPos = 0;

// Add at the top with other state variables
let pageObserver: IntersectionObserver;
let currentlyHighlightedBox: HTMLElement | null = null;
let globalIsDragging = false;
let draggedWordBox: WordBox | null = null;
let dragStartX = 0;
let dragStartY = 0;
let initialWordBoxX = 0;
let initialWordBoxY = 0;
let closestLine: TextLine | null = null;

// Store lines for each page
let textLines: Map<number, TextLine[]> = new Map();

// Add at the top with other state variables
let activeDragLine: TextLine | null = null;

// Add after other state variables
let currentDocumentPath: string | null = null;

// Add at the top with other state variables
let linesAreVisible = true;

// Add at the top with other state variables
let isMetaKeyPressed = false;

// Add after other state variables
let currentDocumentName: string | null = null;
let isDocumentModified = false;

// Add this function to update the document modified state
function updateModifiedState() {
    const wasModified = isDocumentModified;
    isDocumentModified = historyManager.hasUnsavedChanges();
    
    // Only update the UI if the state has changed
    if (wasModified !== isDocumentModified) {
        // Update window title to show modified state
        const title = `📜 Andron${currentDocumentName ? ` - ${currentDocumentName}` : ''}${isDocumentModified ? ' *' : ''}`;
        document.title = title;
    }
}

// Add this function near the top with other utility functions
function adjustTextAreaHeight(element: HTMLTextAreaElement) {
    element.style.height = 'auto';  // Reset height to recalculate
    element.style.height = `${element.scrollHeight}px`;
}

// Custom modal dialog functions
function showModal(title: string, message: string, showNoButton: boolean = true): Promise<'yes' | 'no' | 'cancel'> {
    return new Promise((resolve) => {
        const modalOverlay = document.getElementById('modal-overlay') as HTMLElement;
        const modalTitle = document.getElementById('modal-title') as HTMLElement;
        const modalMessage = document.getElementById('modal-message') as HTMLElement;
        const yesButton = document.getElementById('modal-button-yes') as HTMLButtonElement;
        const noButton = document.getElementById('modal-button-no') as HTMLButtonElement;
        const cancelButton = document.getElementById('modal-button-cancel') as HTMLButtonElement;
        
        // Set modal content
        modalTitle.textContent = title;
        modalMessage.textContent = message;
        
        // Show/hide No button based on parameter
        noButton.style.display = showNoButton ? 'block' : 'none';
        
        // Show the modal
        modalOverlay.classList.add('active');
        
        // Focus the Yes button by default
        yesButton.focus();
        
        // Handle button clicks
        const handleYes = () => {
            modalOverlay.classList.remove('active');
            cleanup();
            resolve('yes');
        };
        
        const handleNo = () => {
            modalOverlay.classList.remove('active');
            cleanup();
            resolve('no');
        };
        
        const handleCancel = () => {
            modalOverlay.classList.remove('active');
            cleanup();
            resolve('cancel');
        };
        
        // Add event listeners
        yesButton.addEventListener('click', handleYes);
        noButton.addEventListener('click', handleNo);
        cancelButton.addEventListener('click', handleCancel);
        
        // Also handle keyboard events
        const handleKeydown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                handleCancel();
            } else if (e.key === 'Enter' && document.activeElement === yesButton) {
                handleYes();
            } else if (e.key === 'Enter' && document.activeElement === noButton) {
                handleNo();
            } else if (e.key === 'Enter' && document.activeElement === cancelButton) {
                handleCancel();
            }
        };
        
        document.addEventListener('keydown', handleKeydown);
        
        // Function to clean up event listeners
        const cleanup = () => {
            yesButton.removeEventListener('click', handleYes);
            noButton.removeEventListener('click', handleNo);
            cancelButton.removeEventListener('click', handleCancel);
            document.removeEventListener('keydown', handleKeydown);
        };
    });
}

// Single load event listener that handles everything
window.addEventListener('load', () => {
    // Set global CSS variables
    document.documentElement.style.setProperty('--cap-height', `${CAP_HEIGHT - 2}px`);
    document.documentElement.style.setProperty('--vertical-spacing', `7.5px`);
    document.documentElement.style.setProperty('--page-gap', `${PAGE_GAP}px`);

    const sidebar = document.getElementById('sidebar') as HTMLElement;
    const rightSidebar = document.getElementById('right-sidebar') as HTMLElement;
    const separator = document.getElementById('separator') as HTMLElement;
    const englishBtn = document.getElementById('english-btn') as HTMLButtonElement;
    const pageBtn = document.getElementById('page-btn') as HTMLButtonElement;
    const lineBtn = document.getElementById('line-btn') as HTMLButtonElement;
    const marginaliaBtn = document.getElementById('marginalia-btn') as HTMLButtonElement;
    const pageNumberBtn = document.getElementById('page-number-btn') as HTMLButtonElement;
    const documentInfoTab = document.getElementById('document-info-tab') as HTMLButtonElement;
    const chapterBtn = document.getElementById('header-btn') as HTMLButtonElement;
    const subchapterBtn = document.getElementById('subheader-btn') as HTMLButtonElement;
    const headlineBtn = document.getElementById('headline-btn') as HTMLButtonElement;

    // Initialize right sidebar tabs
    initRightSidebar();

    // Add document click handler to clear marginalia selection
    document.addEventListener('click', (e) => {
        // If we didn't click on a marginalia box, clear all selections
        if (!(e.target as HTMLElement).closest('.marginalia')) {
            document.querySelectorAll('.marginalia.selected').forEach(box => {
                box.classList.remove('selected');
            });
        }
    });

    // Handle Add Headline button click
    headlineBtn.addEventListener('click', () => {
        // Find the most visible page
        const pages = document.querySelectorAll('.canvas-container');
        let mostVisiblePage: Element | null = null;
        let maxVisibility = 0;

        pages.forEach(page => {
            const rect = page.getBoundingClientRect();
            const visibility = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
            if (visibility > maxVisibility) {
                maxVisibility = visibility;
                mostVisiblePage = page;
            }
        });

        if (mostVisiblePage) {
            const pageDiv = mostVisiblePage as HTMLDivElement;
            const canvas = pageDiv.querySelector('canvas');
            if (canvas) {
                const margins = canvasManager.getGlobalMargins();
                
                // Get the secondary language setting
                const secondaryLanguageSelect = document.getElementById('secondary-language') as HTMLSelectElement;
                const isGreek = secondaryLanguageSelect?.value === 'ancient-greek';
                
                // Create a headline box above the top margin, but closer to it
                const wordBox = new WordBox(margins.left + 3, margins.top - CAP_HEIGHT - 2, 'Headline', '', false, false, isGreek, false, false, true);
                pageDiv.appendChild(wordBox.getElement());
                
                // Record add operation
                historyManager.addOperation(
                    historyManager.createAddBoxOperation(wordBox, pageDiv)
                );
                
                // Start editing the box immediately
                wordBoxManager.startEditingWordBox(wordBox.getElement());
            }
        }
    });

    // Handle Add Page button click
    pageBtn.addEventListener('click', () => {
        canvasManager.createPage();
    });

    // Handle Add Line button click
    lineBtn.addEventListener('click', () => {
        // Find the most visible page
        const pages = document.querySelectorAll('.canvas-container');
        let mostVisiblePage: Element | null = null;
        let maxVisibility = 0;

        pages.forEach(page => {
            const rect = page.getBoundingClientRect();
            const viewHeight = window.innerHeight;
            const visibility = Math.min(rect.bottom, viewHeight) - Math.max(rect.top, 0);
            
            if (visibility > maxVisibility) {
                maxVisibility = visibility;
                mostVisiblePage = page;
            }
        });

        if (mostVisiblePage) {
            const pageNumber = parseInt((mostVisiblePage as HTMLElement).dataset.pageNumber || '1');
            const margins = canvasManager.getGlobalMargins();
            
            // Calculate y position for the new line
            let yPosition = margins.top + CAP_HEIGHT; // Start after top margin
            const existingLines = canvasManager.getTextLines().get(pageNumber) || [];
            if (existingLines.length > 0) {
                // Place the new line below the last line with some spacing
                const lastLine = existingLines[existingLines.length - 1];
                yPosition = lastLine.getYPosition() + BODY_HEIGHT + 10; // 10px spacing between lines
            }

            // Only add the line if it fits within the bottom margin
            if (yPosition + DESCENDER_HEIGHT <= margins.bottom) {
                const newLine = canvasManager.addTextLine(pageNumber, yPosition);
                if (newLine) {
                    // Record add operation
                    historyManager.addOperation(
                        historyManager.createAddLineOperation(newLine, pageNumber)
                    );
                }
            }
        }
    });

    // Handle Add Chapter button click
    chapterBtn.addEventListener('click', () => {
        // Find the most visible page
        const pages = document.querySelectorAll('.canvas-container');
        let mostVisiblePage: Element | null = null;
        let maxVisibility = 0;

        pages.forEach(page => {
            const rect = page.getBoundingClientRect();
            const visibility = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
            if (visibility > maxVisibility) {
                maxVisibility = visibility;
                mostVisiblePage = page;
            }
        });

        if (mostVisiblePage) {
            // Create a new chapter box at (100, 100)
            const wordBox = new WordBox(100, 100, 'New Chapter', '', false, false, false, true);
            (mostVisiblePage as HTMLElement).appendChild(wordBox.getElement());
            wordBox.getElement().focus();

            // Record add operation
            historyManager.addOperation(
                historyManager.createAddBoxOperation(wordBox, mostVisiblePage as HTMLElement)
            );
        }
    });

    // Handle English button click
    englishBtn.addEventListener('click', () => {
        // Find the most visible page
        const pages = document.querySelectorAll('.canvas-container');
        let mostVisiblePage: Element | null = null;
        let maxVisibility = 0;

        pages.forEach(page => {
            const rect = page.getBoundingClientRect();
            const viewHeight = window.innerHeight;
            const visibility = Math.min(rect.bottom, viewHeight) - Math.max(rect.top, 0);
            
            if (visibility > maxVisibility) {
                maxVisibility = visibility;
                mostVisiblePage = page;
            }
        });

        if (mostVisiblePage) {
            const pageDiv = mostVisiblePage as HTMLDivElement;
            const canvas = pageDiv.querySelector('canvas');
            if (canvas) {
                const rect = canvas.getBoundingClientRect();
                const scaleX = 1; // Force scaleX to 1
                const scaleY = canvas.height / rect.height;
                
                // Calculate canvas-relative coordinates
                const x = (100) * scaleX;
                const y = (100) * scaleY;
                
                // Get the current language setting
                const primaryLanguageSelect = document.getElementById('primary-language') as HTMLSelectElement;
                const isGreek = primaryLanguageSelect?.value === 'ancient-greek';
                
                const wordBox = new WordBox(x, y, 'New Word', '', false, false, isGreek);
                pageDiv.appendChild(wordBox.getElement());

                // Record add operation
                historyManager.addOperation(
                    historyManager.createAddBoxOperation(wordBox, pageDiv)
                );
            }
        }
    });

    // Handle Marginalia button click
    marginaliaBtn.addEventListener('click', () => {
        // First clear any existing marginalia selection
        document.querySelectorAll('.marginalia.selected').forEach(box => {
            box.classList.remove('selected');
        });

        // Find the most visible page
        const pages = document.querySelectorAll('.canvas-container');
        let mostVisiblePage: Element | null = null;
        let maxVisibility = 0;

        pages.forEach(page => {
            const rect = page.getBoundingClientRect();
            const viewHeight = window.innerHeight;
            const visibility = Math.min(rect.bottom, viewHeight) - Math.max(rect.top, 0);
            
            if (visibility > maxVisibility) {
                maxVisibility = visibility;
                mostVisiblePage = page;
            }
        });

        if (mostVisiblePage) {
            const pageDiv = mostVisiblePage as HTMLDivElement;
            const canvas = pageDiv.querySelector('canvas');
            if (canvas) {
                const rect = canvas.getBoundingClientRect();
                const scaleX = 1; // Force scaleX to 1
                const scaleY = canvas.height / rect.height;
                
                // Calculate canvas-relative coordinates - position in right margin
                const margins = canvasManager.getGlobalMargins();
                const x = margins.right + 20; // 20px offset from right margin
                const y = margins.top + 20; // 20px offset from top margin
                
                const marginalia = new Marginalia(x, y);
                const element = marginalia.getElement();
                pageDiv.appendChild(element);

                // Record add operation
                historyManager.addOperation(
                    historyManager.createAddMarginaliaOperation(marginalia, pageDiv)
                );

                // Add click handlers for selection
                const handleClick = (e: Event) => {
                    e.stopPropagation(); // Prevent event from bubbling
                    // Clear any existing marginalia selection
                    document.querySelectorAll('.marginalia.selected').forEach(box => {
                        box.classList.remove('selected');
                    });
                    // Select this marginalia box
                    element.classList.add('selected');
                };

                // Add click handler to both the container and the textarea
                element.addEventListener('click', handleClick);
                const textarea = element.querySelector('textarea');
                if (textarea) {
                    textarea.addEventListener('click', handleClick);
                }

                // Add delete capability
                element.addEventListener('keydown', (e: KeyboardEvent) => {
                    if (e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) {
                        e.preventDefault();
                        // Record delete operation before removing
                        historyManager.addOperation(
                            historyManager.createDeleteMarginaliaOperation(marginalia, pageDiv)
                        );
                        element.remove();
                    }
                });

                // Select the newly created marginalia box
                element.classList.add('selected');
            }
        }
    });

    // Handle Add Page Number button click
    pageNumberBtn.addEventListener('click', () => {
        // Find the most visible page
        const pages = document.querySelectorAll('.canvas-container');
        let mostVisiblePage: Element | null = null;
        let maxVisibility = 0;

        pages.forEach(page => {
            const rect = page.getBoundingClientRect();
            const viewHeight = window.innerHeight;
            const visibility = Math.min(rect.bottom, viewHeight) - Math.max(rect.top, 0);
            
            if (visibility > maxVisibility) {
                maxVisibility = visibility;
                mostVisiblePage = page;
            }
        });

        if (mostVisiblePage) {
            const pageEl = mostVisiblePage as HTMLElement;
            const pageNumber = parseInt(pageEl.dataset.pageNumber || '1');
            const canvas = pageEl.querySelector('canvas');
            
            if (canvas) {
                const margins = canvasManager.getGlobalMargins();
                const rect = canvas.getBoundingClientRect();
                const scaleY = canvas.height / rect.height;
                
                // Position the page number box in the bottom right corner with some margin
                const x = margins.right - 50; // 50px from right margin
                const y = margins.bottom - CAP_HEIGHT - 10; // 10px from bottom margin
                
                // Create the page number box with just the numeral
                const pageNumberBox = new WordBox(x, y, `${pageNumber}`, '', false, false);
                const pageNumberEl = pageNumberBox.getElement();
                
                // Remove all circles and lines
                pageNumberEl.querySelectorAll('.wordbox-circle-top, .wordbox-circle-bottom, .wordbox-line-top, .wordbox-line-bottom').forEach(el => el.remove());
                
                // Make the box non-editable and non-double-clickable
                const rectContainer = pageNumberEl.querySelector('.wordbox-rect') as HTMLElement;
                if (rectContainer) {
                    rectContainer.style.userSelect = 'none';  // Prevent text selection
                    rectContainer.setAttribute('data-non-editable', 'true');  // Mark as non-editable
                }
                pageNumberEl.classList.add('page-number-box');  // Add class to identify page number boxes
                
                // Prevent double-click handling
                pageNumberEl.addEventListener('dblclick', (e) => {
                    e.stopPropagation();  // Stop event from reaching the word box handler
                });
                
                pageEl.appendChild(pageNumberEl);

                // Record add operation
                historyManager.addOperation(
                    historyManager.createAddBoxOperation(pageNumberBox, pageEl)
                );
            }
        }
    });

    // Handle Add Section button click
    subchapterBtn.addEventListener('click', () => {
        // Find the most visible page
        const pages = document.querySelectorAll('.canvas-container');
        let mostVisiblePage: Element | null = null;
        let maxVisibility = 0;

        pages.forEach(page => {
            const rect = page.getBoundingClientRect();
            const visibility = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
            if (visibility > maxVisibility) {
                maxVisibility = visibility;
                mostVisiblePage = page;
            }
        });

        if (mostVisiblePage) {
            // Create a new section box at (100, 100)
            const wordBox = new WordBox(100, 100, 'New Section', '', false, false, false, false, true);
            (mostVisiblePage as HTMLElement).appendChild(wordBox.getElement());
            wordBox.getElement().focus();

            // Record add operation
            historyManager.addOperation(
                historyManager.createAddBoxOperation(wordBox, mostVisiblePage as HTMLElement)
            );
        }
    });

    // Create first page and clear main content
    const mainContent = document.querySelector('#main-content');
    if (mainContent) {
        mainContent.innerHTML = '';
        const { canvas, wrapper } = canvasManager.createPage();
        // Make the canvas container focusable
        wrapper.setAttribute('tabindex', '-1');
        wrapper.style.outline = 'none'; // Hide the focus outline
    }

    // Add keydown handler for line visibility toggle
    document.addEventListener('keydown', (e: KeyboardEvent) => {
        // Check if we're in an input field
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
            return;
        }

        // Handle meta key (Command on Mac, Control on Windows)
        if (e.metaKey || e.ctrlKey) {
            if (e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    historyManager.redo();
                } else {
                    historyManager.undo();
                }
                return;
            }
            // Add save shortcut
            if (e.key.toLowerCase() === 's') {
                e.preventDefault();
                saveDocument();
                return;
            }
        }

        // Toggle visibility with 'v' key regardless of selection state
        if (e.key === 'v') {
            WordBox.linesAreVisible = !WordBox.linesAreVisible;
            
            // Toggle class on all wordboxes
            document.querySelectorAll('.wordbox').forEach(box => {
                box.classList.toggle('lines-hidden', !WordBox.linesAreVisible);
            });
            
            // Redraw all canvases to update line visibility
            document.querySelectorAll('.canvas-container canvas').forEach(canvas => {
                canvasManager.clearCanvas(canvas as HTMLCanvasElement);
                canvasManager.drawAllLines(canvas as HTMLCanvasElement);
            });
        }

        // Delete empty selected lines with 'x' key
        if (e.key === 'x') {
            // Find the most visible page
            const pages = document.querySelectorAll('.canvas-container');
            let mostVisiblePage: Element | null = null;
            let maxVisibility = 0;

            pages.forEach(page => {
                const rect = page.getBoundingClientRect();
                const viewHeight = window.innerHeight;
                const visibility = Math.min(rect.bottom, viewHeight) - Math.max(rect.top, 0);
                
                if (visibility > maxVisibility) {
                    maxVisibility = visibility;
                    mostVisiblePage = page;
                }
            });

            if (mostVisiblePage) {
                const pageNumber = parseInt((mostVisiblePage as HTMLElement).dataset.pageNumber || '1');
                const lines = canvasManager.getTextLines().get(pageNumber) || [];
                
                // Find any selected empty lines on this page
                lines.forEach(line => {
                    if (line.isSelected() && line.isEmpty()) {
                        // Record delete operation before deleting
                        historyManager.addOperation(
                            historyManager.createDeleteLineOperation(line, pageNumber)
                        );
                        canvasManager.deleteLine(line);
                    }
                });
            }
        }
    });

    document.addEventListener('keyup', (e: KeyboardEvent) => {
        if (e.key === 'Meta' || e.key === 'Control') {
            isMetaKeyPressed = false;
        }
    });

    // Add language change handlers
    const primaryLanguageSelect = document.getElementById('primary-language') as HTMLSelectElement;
    const secondaryLanguageSelect = document.getElementById('secondary-language') as HTMLSelectElement;

    primaryLanguageSelect?.addEventListener('change', () => {
        const isGreek = primaryLanguageSelect.value === 'ancient-greek';
        // Update all parent boxes
        WordBox.instances.forEach(box => {
            if (!box.getParentId()) { // If this is a parent box
                box.setIsGreekText(isGreek);
            }
        });
    });

    secondaryLanguageSelect?.addEventListener('change', () => {
        const isGreek = secondaryLanguageSelect.value === 'ancient-greek';
        // Update all child boxes
        WordBox.instances.forEach(box => {
            if (box.getParentId()) { // If this is a child box
                box.setIsGreekText(isGreek);
            }
        });
    });

    // Add auto-expand functionality for the document title
    const documentTitle = document.getElementById('document-title') as HTMLTextAreaElement;
    if (documentTitle) {
        const adjustHeight = () => {
            documentTitle.style.height = 'auto';
            documentTitle.style.height = documentTitle.scrollHeight + 'px';
        };
        
        documentTitle.addEventListener('input', adjustHeight);
        // Also adjust on tab switch in case there's existing content
        documentInfoTab.addEventListener('click', adjustHeight);
    }

    // Add auto-expand functionality for the document author
    const documentAuthor = document.getElementById('document-author') as HTMLTextAreaElement;
    if (documentAuthor) {
        const adjustHeight = () => {
            documentAuthor.style.height = 'auto';
            documentAuthor.style.height = documentAuthor.scrollHeight + 'px';
        };
        
        documentAuthor.addEventListener('input', adjustHeight);
        // Also adjust on tab switch in case there's existing content
        documentInfoTab.addEventListener('click', adjustHeight);
    }

    // Add event listeners for page format inputs
    const dpiInput = document.getElementById('dpi-input') as HTMLInputElement;
    const widthInput = document.getElementById('width-input') as HTMLInputElement;
    const heightInput = document.getElementById('height-input') as HTMLInputElement;
    const resetButton = document.getElementById('reset-params') as HTMLButtonElement;

    // Add event listeners for margin inputs
    const marginTopInput = document.getElementById('margin-top') as HTMLInputElement;
    const marginRightInput = document.getElementById('margin-right') as HTMLInputElement;
    const marginBottomInput = document.getElementById('margin-bottom') as HTMLInputElement;
    const marginLeftInput = document.getElementById('margin-left') as HTMLInputElement;
    const glueInput = document.getElementById('glue-input') as HTMLInputElement;
    const verticalSpacingInput = document.getElementById('vertical-spacing-input') as HTMLInputElement;

    // Function to update page dimensions
    const updatePageDimensions = () => {
        const dpi = parseInt(dpiInput.value);
        const widthInches = parseFloat(widthInput.value);
        const heightInches = parseFloat(heightInput.value);

        if (!isNaN(dpi) && !isNaN(widthInches) && !isNaN(heightInches)) {
            canvasManager.updateDimensionsForDPI(dpi);
            canvasManager.updateDimensionsForInches(widthInches, heightInches);

            // Update all canvases
            document.querySelectorAll('.canvas-container canvas').forEach(canvas => {
                const canvasEl = canvas as HTMLCanvasElement;
                canvasEl.width = canvasManager.getCurrentPageWidth();
                canvasEl.height = canvasManager.getCurrentPageHeight();
                canvasManager.clearCanvas(canvasEl);
                canvasManager.drawAllLines(canvasEl);
            });

            // Update thumbnails
            canvasManager.updateThumbnails();
        }
    };

    // Add input event listeners for immediate response
    const handleMarginInput = (e: Event) => {
        const input = e.target as HTMLInputElement;
        let value = input.value;
        
        // Allow any input while typing, we'll validate on enter/blur
        if (value === '' || value === '.' || value === '-') {
            return;
        }
        
        const numValue = parseFloat(value);
        if (!isNaN(numValue)) {
            // Only clamp if the value is outside bounds
            if (numValue < 0 || numValue > 5) {
                input.value = canvasManager.formatMarginValue(value);
            }
        }
    };

    // Add blur event listeners to ensure valid values when focus is lost
    const handleMarginBlur = (e: Event) => {
        const input = e.target as HTMLInputElement;
        input.value = canvasManager.formatMarginValue(input.value);
        canvasManager.updateMarginsFromInputs({
            top: marginTopInput.value,
            right: marginRightInput.value,
            bottom: marginBottomInput.value,
            left: marginLeftInput.value
        });
    };

    // Handle enter key to update margins
    const handleMarginKeydown = (e: KeyboardEvent) => {
        const input = e.target as HTMLInputElement;
                
        // Update on enter or tab
        if (e.key === 'Enter' || e.key === 'Tab') {
            input.value = canvasManager.formatMarginValue(input.value);
            canvasManager.updateMarginsFromInputs({
                top: marginTopInput.value,
                right: marginRightInput.value,
                bottom: marginBottomInput.value,
                left: marginLeftInput.value
            });
            if (e.key === 'Enter') {
                input.blur();
            }
            return;
        }
        
        // Allow: backspace, delete, tab, escape, enter, decimal point
        if ([46, 8, 9, 27, 13, 110, 190].indexOf(e.keyCode) !== -1 ||
            // Allow: Ctrl+A
            (e.keyCode === 65 && e.ctrlKey === true) ||
            // Allow: home, end, left, right
            (e.keyCode >= 35 && e.keyCode <= 39) ||
            // Allow numbers
            (e.keyCode >= 48 && e.keyCode <= 57) ||
            // Allow numpad numbers
            (e.keyCode >= 96 && e.keyCode <= 105)) {
            console.log('Allowed key:', e.key);
            return;
        }
        e.preventDefault();
    };

    // Add event listeners to margin inputs
    [marginTopInput, marginRightInput, marginBottomInput, marginLeftInput].forEach(input => {
        input.addEventListener('input', handleMarginInput);
        input.addEventListener('blur', handleMarginBlur);
        input.addEventListener('keydown', handleMarginKeydown);
    });

    // Add event listeners for margin checkboxes
    const marginTopCheck = document.getElementById('margin-top-check') as HTMLInputElement;
    const marginRightCheck = document.getElementById('margin-right-check') as HTMLInputElement;
    const marginBottomCheck = document.getElementById('margin-bottom-check') as HTMLInputElement;
    const marginLeftCheck = document.getElementById('margin-left-check') as HTMLInputElement;

    const updateMarginLineStyle = (line: HTMLElement, checked: boolean) => {
        const isVertical = line.style.cursor === 'col-resize';
        if (checked) {
            // Solid line - constrained between margins
            if (isVertical) {
                line.style.top = `${canvasManager.getGlobalMargins().top}px`;
                line.style.height = `${canvasManager.getGlobalMargins().bottom - canvasManager.getGlobalMargins().top}px`;
                line.style.borderLeft = '2px solid black';
            } else {
                line.style.left = `${canvasManager.getGlobalMargins().left - PAGE_MARGIN}px`;
                line.style.width = `${canvasManager.getGlobalMargins().right - canvasManager.getGlobalMargins().left}px`;
                line.style.borderTop = '2px solid black';
            }
        } else {
            // Dotted line - extends full page
            if (isVertical) {
                line.style.top = '0px';
                line.style.height = `${canvasManager.getCurrentPageHeight()}px`;
                line.style.borderLeft = '2px dotted #999';
            } else {
                line.style.left = '0px';
                line.style.width = `${canvasManager.getCurrentPageWidth()}px`;
                line.style.borderTop = '2px dotted #999';
            }
        }
    };

    const handleMarginCheckChange = (e: Event) => {
        // Simply call updateAllMargins to recreate all margin lines with the new state
        canvasManager.updateAllMargins();
    };

    [marginTopCheck, marginRightCheck, marginBottomCheck, marginLeftCheck].forEach(checkbox => {
        checkbox.addEventListener('change', handleMarginCheckChange);
    });

    // Add event listeners for spacing inputs
    const handleGlueInput = (e: Event) => {
        const input = e.target as HTMLInputElement;
        let value = input.value;
        
        // Allow empty input while typing
        if (value === '') {
            return;
        }
        
        const numValue = parseInt(value);
        if (!isNaN(numValue)) {
            // Ensure non-negative integer
            if (numValue < 0) {
                input.value = '3';
            }
        } else {
            input.value = '3';
        }
    };

    const handleVerticalSpacingInput = (e: Event) => {
        const input = e.target as HTMLInputElement;
        let value = input.value;
        
        // Allow empty input while typing
        if (value === '') {
            return;
        }
        
        const numValue = parseFloat(value);
        if (!isNaN(numValue)) {
            // Only limit the maximum value
            if (numValue > 7.5) {
                input.value = '7.5';
                WordBox.updateVerticalSpacing(7.5);
            } else {
                // Update vertical spacing immediately with the new value
                WordBox.updateVerticalSpacing(numValue);
            }
        } else {
            input.value = '7.5';
            WordBox.updateVerticalSpacing(7.5);
        }
    };

    const handleGlueBlur = (e: Event) => {
        const input = e.target as HTMLInputElement;
        const value = input.value.trim();
        
        if (value === '' || isNaN(parseInt(value))) {
            input.value = '3';
        }
    };

    const handleVerticalSpacingBlur = (e: Event) => {
        const input = e.target as HTMLInputElement;
        const value = input.value.trim();
        
        if (value === '' || isNaN(parseFloat(value))) {
            input.value = '7.5';
            WordBox.updateVerticalSpacing(7.5);
        }
    };

    const handleGlueKeydown = (e: KeyboardEvent) => {
        const input = e.target as HTMLInputElement;
        
        // Only handle Enter key for glue input
        if (e.key === 'Enter') {
            e.preventDefault();
            const value = input.value.trim();
            if (value === '' || isNaN(parseInt(value))) {
                input.value = '3';
            }
            input.blur();
            return;
        }
        
        // Allow: backspace, delete, tab, escape, enter
        if ([46, 8, 9, 27, 13].indexOf(e.keyCode) !== -1 ||
            // Allow: Ctrl+A
            (e.keyCode === 65 && e.ctrlKey === true) ||
            // Allow: home, end, left, right
            (e.keyCode >= 35 && e.keyCode <= 39) ||
            // Allow numbers
            (e.keyCode >= 48 && e.keyCode <= 57) ||
            // Allow numpad numbers
            (e.keyCode >= 96 && e.keyCode <= 105)) {
            return;
        }
        e.preventDefault();
    };

    const handleVerticalSpacingKeydown = (e: KeyboardEvent) => {
        const input = e.target as HTMLInputElement;
        
        // Only handle Enter key for vertical spacing input
        if (e.key === 'Enter') {
            e.preventDefault();
            const value = input.value.trim();
            if (value === '' || isNaN(parseFloat(value))) {
                input.value = '7.5';
                WordBox.updateVerticalSpacing(7.5);
            } else {
                const numValue = parseFloat(value);
                WordBox.updateVerticalSpacing(Math.min(7.5, numValue));
            }
            input.blur();
            return;
        }
        
        // Allow: backspace, delete, tab, escape, enter, decimal point, minus sign
        if ([46, 8, 9, 27, 13, 110, 190, 189].indexOf(e.keyCode) !== -1 ||
            // Allow: Ctrl+A
            (e.keyCode === 65 && e.ctrlKey === true) ||
            // Allow: home, end, left, right
            (e.keyCode >= 35 && e.keyCode <= 39) ||
            // Allow numbers
            (e.keyCode >= 48 && e.keyCode <= 57) ||
            // Allow numpad numbers
            (e.keyCode >= 96 && e.keyCode <= 105)) {
            return;
        }
        e.preventDefault();
    };

    glueInput.addEventListener('input', handleGlueInput);
    glueInput.addEventListener('blur', handleGlueBlur);
    glueInput.addEventListener('keydown', handleGlueKeydown);

    verticalSpacingInput.addEventListener('input', handleVerticalSpacingInput);
    verticalSpacingInput.addEventListener('blur', handleVerticalSpacingBlur);
    verticalSpacingInput.addEventListener('keydown', handleVerticalSpacingKeydown);

    // Add change event listeners for DPI and page dimensions
    dpiInput.addEventListener('change', () => {
        updatePageDimensions();
        // After dimensions are updated, we need to update margins to maintain their relative positions
        const dpi = parseInt(dpiInput.value);
        if (!isNaN(dpi)) {
            canvasManager.updateMarginsFromInputs({
                top: marginTopInput.value,
                right: marginRightInput.value,
                bottom: marginBottomInput.value,
                left: marginLeftInput.value
            });
        }
    });
    widthInput.addEventListener('change', () => {
        updatePageDimensions();
        // After dimensions are updated, we need to update the right margin to maintain its relative position
        const dpi = parseInt(dpiInput.value);
        if (!isNaN(dpi)) {
            canvasManager.updateMarginsFromInputs({
                top: marginTopInput.value,
                right: marginRightInput.value,
                bottom: marginBottomInput.value,
                left: marginLeftInput.value
            });
        }
    });
    heightInput.addEventListener('change', () => {
        updatePageDimensions();
        // After dimensions are updated, we need to update the bottom margin to maintain its relative position
        const dpi = parseInt(dpiInput.value);
        if (!isNaN(dpi)) {
            canvasManager.updateMarginsFromInputs({
                top: marginTopInput.value,
                right: marginRightInput.value,
                bottom: marginBottomInput.value,
                left: marginLeftInput.value
            });
        }
    });

    // Update reset button handler to include vertical spacing
    resetButton.addEventListener('click', () => {
        // Reset to default values
        dpiInput.value = '96';
        widthInput.value = '8.5';
        heightInput.value = '11';
        marginTopInput.value = '0.75';
        marginRightInput.value = '0.75';
        marginBottomInput.value = '0.75';
        marginLeftInput.value = '0.75';
        glueInput.value = '3';
        verticalSpacingInput.value = '7.5';
        WordBox.updateVerticalSpacing(7.5);

        // Update both dimensions and margins
        updatePageDimensions();
        canvasManager.updateMarginsFromInputs({
            top: marginTopInput.value,
            right: marginRightInput.value,
            bottom: marginBottomInput.value,
            left: marginLeftInput.value
        });
    });
});

// Function to initialize right sidebar
function initRightSidebar() {
    const rightSidebar = document.getElementById('right-sidebar');
    if (!rightSidebar) return;

    // Clear existing content
    rightSidebar.innerHTML = '';

    // Create tab bar
    const tabBar = document.createElement('div');
    tabBar.className = 'tab-bar';

    // Create tab buttons
    const pagesTab = document.createElement('button');
    pagesTab.className = 'tab-button active';
    pagesTab.title = 'Thumbnails';
    pagesTab.innerHTML = `<img src="../assets/icons/gallery-thumbnails.svg" alt="Thumbnails" />`;

    const paramsTab = document.createElement('button');
    paramsTab.className = 'tab-button';
    paramsTab.title = 'Page Format';
    paramsTab.innerHTML = `<img src="../assets/icons/proportions.svg" alt="Page Format" />`;

    const languagesTab = document.createElement('button');
    languagesTab.className = 'tab-button';
    languagesTab.title = 'Languages';
    languagesTab.innerHTML = `<img src="../assets/icons/languages.svg" alt="Languages" />`;

    const documentInfoTab = document.createElement('button');
    documentInfoTab.className = 'tab-button';
    documentInfoTab.title = 'Document Info';
    documentInfoTab.innerHTML = `<img src="../assets/icons/book-text.svg" alt="Document Info" />`;

    tabBar.appendChild(pagesTab);
    tabBar.appendChild(paramsTab);
    tabBar.appendChild(languagesTab);
    tabBar.appendChild(documentInfoTab);

    // Create content containers
    const pagesContent = document.createElement('div');
    pagesContent.className = 'tab-content active';
    pagesContent.id = 'pages-content';

    const paramsContent = document.createElement('div');
    paramsContent.className = 'tab-content';
    paramsContent.id = 'params-content';

    const languagesContent = document.createElement('div');
    languagesContent.className = 'tab-content';
    languagesContent.id = 'languages-content';

    const documentInfoContent = document.createElement('div');
    documentInfoContent.className = 'tab-content';
    documentInfoContent.id = 'document-info-content';
    documentInfoContent.innerHTML = `
        <div class="sidebar-title">Document Info</div>
        <div class="param-group">
            <label for="document-title">Document Title:</label>
            <textarea id="document-title" class="param-input auto-expand" rows="1"></textarea>
        </div>
        <div class="param-group">
            <label for="document-author">Document Author:</label>
            <textarea id="document-author" class="param-input auto-expand" rows="1"></textarea>
        </div>
        <div class="param-group">
            <label for="document-translator">Translator:</label>
            <textarea id="document-translator" class="param-input auto-expand" rows="1"></textarea>
        </div>
        <div class="param-group">
            <label for="document-notes">Notes:</label>
            <textarea id="document-notes" class="param-input auto-expand" rows="3"></textarea>
        </div>
    `;

    // Create languages content
    languagesContent.innerHTML = `
        <div class="sidebar-title">Languages</div>
        <div class="param-group">
            <label for="primary-language">Primary Language (Parent Boxes):</label>
            <select id="primary-language" class="param-input">
                <option value="english">English</option>
                <option value="ancient-greek">Ancient Greek (with polytonic diacritics)</option>
            </select>
        </div>
        <div class="param-group">
            <label for="secondary-language">Secondary Language (Child Boxes):</label>
            <select id="secondary-language" class="param-input">
                <option value="english">English</option>
                <option value="ancient-greek">Ancient Greek (with polytonic diacritics)</option>
            </select>
        </div>
    `;

    // Create page parameters form
    const margins = canvasManager.getGlobalMargins();
    const dpi = canvasManager.getCurrentDPI();
    const pageWidth = canvasManager.getCurrentPageWidth();
    const pageHeight = canvasManager.getCurrentPageHeight();

    paramsContent.innerHTML = `
        <div class="sidebar-title">Page Format</div>
        <div class="param-group">
            <label for="dpi-input">DPI:</label>
            <input type="number" id="dpi-input" value="${dpi}" min="72" max="300" step="1">
        </div>
        <div class="param-group">
            <label for="width-input">Page Width:</label>
            <div class="input-with-unit">
                <input type="number" id="width-input" value="${(pageWidth / dpi).toFixed(2)}" min="1" max="48" step="0.5">
                <span class="unit">inches</span>
            </div>
        </div>
        <div class="param-group">
            <label for="height-input">Page Height:</label>
            <div class="input-with-unit">
                <input type="number" id="height-input" value="${(pageHeight / dpi).toFixed(2)}" min="1" max="48" step="0.5">
                <span class="unit">inches</span>
            </div>
        </div>
        <button id="reset-params" class="reset-button">Reset to Defaults</button>
        <div class="margin-inputs">
            <div class="margin-title">Page Margins</div>
            <div class="margin-group">
                <div class="margin-input">
                    <label for="margin-top">
                        <input type="checkbox" id="margin-top-check">
                        <span>Top:</span>
                    </label>
                    <div class="input-with-unit">
                        <input type="text" id="margin-top" value="${(margins.top / dpi).toFixed(2)}" min="0" max="5" step="0.125">
                        <span class="unit">inches</span>
                    </div>
                </div>
                <div class="margin-input">
                    <label for="margin-right">
                        <input type="checkbox" id="margin-right-check">
                        <span>Right:</span>
                    </label>
                    <div class="input-with-unit">
                        <input type="text" id="margin-right" value="${((pageWidth - margins.right) / dpi).toFixed(2)}" min="0" max="5" step="0.125">
                        <span class="unit">inches</span>
                    </div>
                </div>
                <div class="margin-input">
                    <label for="margin-bottom">
                        <input type="checkbox" id="margin-bottom-check">
                        <span>Bottom:</span>
                    </label>
                    <div class="input-with-unit">
                        <input type="text" id="margin-bottom" value="${((pageHeight - margins.bottom) / dpi).toFixed(2)}" min="0" max="5" step="0.125">
                        <span class="unit">inches</span>
                    </div>
                </div>
                <div class="margin-input">
                    <label for="margin-left">
                        <input type="checkbox" id="margin-left-check">
                        <span>Left:</span>
                    </label>
                    <div class="input-with-unit">
                        <input type="text" id="margin-left" value="${(margins.left / dpi).toFixed(2)}" min="0" max="5" step="0.125">
                        <span class="unit">inches</span>
                    </div>
                </div>
            </div>
        </div>
        <div class="param-group">
            <div class="section-title">Spacing</div>
            <div class="spacing-inputs">
                <div class="spacing-input">
                    <label for="glue-input">Horizontal:</label>
                    <div class="input-with-unit">
                        <input type="number" id="glue-input" value="3" min="0" step="1">
                        <span class="unit">pixels</span>
                    </div>
                </div>
                <div class="spacing-input">
                    <label for="vertical-spacing-input">Vertical:</label>
                    <div class="input-with-unit">
                        <input type="number" id="vertical-spacing-input" value="7.5" max="7.5" step="0.5">
                        <span class="unit">pixels</span>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Create thumbnails container in pages content
    const thumbnailsContainer = document.createElement('div');
    thumbnailsContainer.id = 'page-thumbnails';
    pagesContent.appendChild(thumbnailsContainer);

    // Add everything to the sidebar
    rightSidebar.appendChild(tabBar);
    rightSidebar.appendChild(pagesContent);
    rightSidebar.appendChild(paramsContent);
    rightSidebar.appendChild(languagesContent);
    rightSidebar.appendChild(documentInfoContent);

    // Add tab switching functionality
    const switchTab = (clickedTab: HTMLButtonElement) => {
        // Update tab buttons
        document.querySelectorAll('.tab-button').forEach(tab => {
            tab.classList.remove('active');
        });
        clickedTab.classList.add('active');

        // Update content visibility
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        const contentId = clickedTab === pagesTab ? 'pages-content' : 
                        clickedTab === paramsTab ? 'params-content' : 
                        clickedTab === languagesTab ? 'languages-content' : 
                        'document-info-content';
        const content = document.getElementById(contentId);
        if (content) {
            content.classList.add('active');
            // If switching to document info tab, adjust all textarea heights
            if (contentId === 'document-info-content') {
                content.querySelectorAll('.auto-expand').forEach(textarea => {
                    adjustTextAreaHeight(textarea as HTMLTextAreaElement);
                });
            }
        }
    };

    pagesTab.addEventListener('click', () => switchTab(pagesTab));
    paramsTab.addEventListener('click', () => switchTab(paramsTab));
    languagesTab.addEventListener('click', () => switchTab(languagesTab));
    documentInfoTab.addEventListener('click', () => switchTab(documentInfoTab));

    // Set up auto-expand for document info fields
    const textareas = documentInfoContent.querySelectorAll('.auto-expand');
    textareas.forEach(textarea => {
        const textareaEl = textarea as HTMLTextAreaElement;
        textareaEl.addEventListener('input', () => adjustTextAreaHeight(textareaEl));
    });

    // Add event listeners for page format inputs
    const dpiInput = document.getElementById('dpi-input') as HTMLInputElement;
    const widthInput = document.getElementById('width-input') as HTMLInputElement;
    const heightInput = document.getElementById('height-input') as HTMLInputElement;
    const resetButton = document.getElementById('reset-params') as HTMLButtonElement;

    // Add event listeners for margin inputs
    const marginTopInput = document.getElementById('margin-top') as HTMLInputElement;
    const marginRightInput = document.getElementById('margin-right') as HTMLInputElement;
    const marginBottomInput = document.getElementById('margin-bottom') as HTMLInputElement;
    const marginLeftInput = document.getElementById('margin-left') as HTMLInputElement;
    const glueInput = document.getElementById('glue-input') as HTMLInputElement;
    const verticalSpacingInput = document.getElementById('vertical-spacing-input') as HTMLInputElement;

    // Function to update page dimensions
    const updatePageDimensions = () => {
        const dpi = parseInt(dpiInput.value);
        const widthInches = parseFloat(widthInput.value);
        const heightInches = parseFloat(heightInput.value);

        if (!isNaN(dpi) && !isNaN(widthInches) && !isNaN(heightInches)) {
            canvasManager.updateDimensionsForDPI(dpi);
            canvasManager.updateDimensionsForInches(widthInches, heightInches);

            // Update all canvases
            document.querySelectorAll('.canvas-container canvas').forEach(canvas => {
                const canvasEl = canvas as HTMLCanvasElement;
                canvasEl.width = canvasManager.getCurrentPageWidth();
                canvasEl.height = canvasManager.getCurrentPageHeight();
                canvasManager.clearCanvas(canvasEl);
                canvasManager.drawAllLines(canvasEl);
            });

            // Update thumbnails
            canvasManager.updateThumbnails();
        }
    };

    // Add input event listeners for immediate response
    const handleMarginInput = (e: Event) => {
        const input = e.target as HTMLInputElement;
        let value = input.value;
        
        // Allow any input while typing, we'll validate on enter/blur
        if (value === '' || value === '.' || value === '-') {
            return;
        }
        
        const numValue = parseFloat(value);
        if (!isNaN(numValue)) {
            // Only clamp if the value is outside bounds
            if (numValue < 0 || numValue > 5) {
                input.value = canvasManager.formatMarginValue(value);
            }
        }
    };

    // Add blur event listeners to ensure valid values when focus is lost
    const handleMarginBlur = (e: Event) => {
        const input = e.target as HTMLInputElement;
        input.value = canvasManager.formatMarginValue(input.value);
        canvasManager.updateMarginsFromInputs({
            top: marginTopInput.value,
            right: marginRightInput.value,
            bottom: marginBottomInput.value,
            left: marginLeftInput.value
        });
    };

    // Handle enter key to update margins
    const handleMarginKeydown = (e: KeyboardEvent) => {
        const input = e.target as HTMLInputElement;
                
        // Update on enter or tab
        if (e.key === 'Enter' || e.key === 'Tab') {
            input.value = canvasManager.formatMarginValue(input.value);
            canvasManager.updateMarginsFromInputs({
                top: marginTopInput.value,
                right: marginRightInput.value,
                bottom: marginBottomInput.value,
                left: marginLeftInput.value
            });
            if (e.key === 'Enter') {
                input.blur();
            }
            return;
        }
        
        // Allow: backspace, delete, tab, escape, enter, decimal point
        if ([46, 8, 9, 27, 13, 110, 190].indexOf(e.keyCode) !== -1 ||
            // Allow: Ctrl+A
            (e.keyCode === 65 && e.ctrlKey === true) ||
            // Allow: home, end, left, right
            (e.keyCode >= 35 && e.keyCode <= 39) ||
            // Allow numbers
            (e.keyCode >= 48 && e.keyCode <= 57) ||
            // Allow numpad numbers
            (e.keyCode >= 96 && e.keyCode <= 105)) {
            console.log('Allowed key:', e.key);
            return;
        }
        e.preventDefault();
    };

    // Add event listeners to margin inputs
    [marginTopInput, marginRightInput, marginBottomInput, marginLeftInput].forEach(input => {
        input.addEventListener('input', handleMarginInput);
        input.addEventListener('blur', handleMarginBlur);
        input.addEventListener('keydown', handleMarginKeydown);
    });

    // Add event listeners for margin checkboxes
    const marginTopCheck = document.getElementById('margin-top-check') as HTMLInputElement;
    const marginRightCheck = document.getElementById('margin-right-check') as HTMLInputElement;
    const marginBottomCheck = document.getElementById('margin-bottom-check') as HTMLInputElement;
    const marginLeftCheck = document.getElementById('margin-left-check') as HTMLInputElement;

    const updateMarginLineStyle = (line: HTMLElement, checked: boolean) => {
        const isVertical = line.style.cursor === 'col-resize';
        if (checked) {
            // Solid line - constrained between margins
            if (isVertical) {
                line.style.top = `${canvasManager.getGlobalMargins().top}px`;
                line.style.height = `${canvasManager.getGlobalMargins().bottom - canvasManager.getGlobalMargins().top}px`;
                line.style.borderLeft = '2px solid black';
            } else {
                line.style.left = `${canvasManager.getGlobalMargins().left - PAGE_MARGIN}px`;
                line.style.width = `${canvasManager.getGlobalMargins().right - canvasManager.getGlobalMargins().left}px`;
                line.style.borderTop = '2px solid black';
            }
        } else {
            // Dotted line - extends full page
            if (isVertical) {
                line.style.top = '0px';
                line.style.height = `${canvasManager.getCurrentPageHeight()}px`;
                line.style.borderLeft = '2px dotted #999';
            } else {
                line.style.left = '0px';
                line.style.width = `${canvasManager.getCurrentPageWidth()}px`;
                line.style.borderTop = '2px dotted #999';
            }
        }
    };

    const handleMarginCheckChange = (e: Event) => {
        // Simply call updateAllMargins to recreate all margin lines with the new state
        canvasManager.updateAllMargins();
    };

    [marginTopCheck, marginRightCheck, marginBottomCheck, marginLeftCheck].forEach(checkbox => {
        checkbox.addEventListener('change', handleMarginCheckChange);
    });

    // Add event listeners for spacing inputs
    const handleGlueInput = (e: Event) => {
        const input = e.target as HTMLInputElement;
        let value = input.value;
        
        // Allow empty input while typing
        if (value === '') {
            return;
        }
        
        const numValue = parseInt(value);
        if (!isNaN(numValue)) {
            // Ensure non-negative integer
            if (numValue < 0) {
                input.value = '3';
            }
        } else {
            input.value = '3';
        }
    };

    const handleVerticalSpacingInput = (e: Event) => {
        const input = e.target as HTMLInputElement;
        let value = input.value;
        
        // Allow empty input while typing
        if (value === '') {
            return;
        }
        
        const numValue = parseFloat(value);
        if (!isNaN(numValue)) {
            // Only limit the maximum value
            if (numValue > 7.5) {
                input.value = '7.5';
                WordBox.updateVerticalSpacing(7.5);
            } else {
                // Update vertical spacing immediately with the new value
                WordBox.updateVerticalSpacing(numValue);
            }
        } else {
            input.value = '7.5';
            WordBox.updateVerticalSpacing(7.5);
        }
    };

    const handleGlueBlur = (e: Event) => {
        const input = e.target as HTMLInputElement;
        const value = input.value.trim();
        
        if (value === '' || isNaN(parseInt(value))) {
            input.value = '3';
        }
    };

    const handleVerticalSpacingBlur = (e: Event) => {
        const input = e.target as HTMLInputElement;
        const value = input.value.trim();
        
        if (value === '' || isNaN(parseFloat(value))) {
            input.value = '7.5';
            WordBox.updateVerticalSpacing(7.5);
        }
    };

    const handleGlueKeydown = (e: KeyboardEvent) => {
        const input = e.target as HTMLInputElement;
        
        // Only handle Enter key for glue input
        if (e.key === 'Enter') {
            e.preventDefault();
            const value = input.value.trim();
            if (value === '' || isNaN(parseInt(value))) {
                input.value = '3';
            }
            input.blur();
            return;
        }
        
        // Allow: backspace, delete, tab, escape, enter
        if ([46, 8, 9, 27, 13].indexOf(e.keyCode) !== -1 ||
            // Allow: Ctrl+A
            (e.keyCode === 65 && e.ctrlKey === true) ||
            // Allow: home, end, left, right
            (e.keyCode >= 35 && e.keyCode <= 39) ||
            // Allow numbers
            (e.keyCode >= 48 && e.keyCode <= 57) ||
            // Allow numpad numbers
            (e.keyCode >= 96 && e.keyCode <= 105)) {
            return;
        }
        e.preventDefault();
    };

    const handleVerticalSpacingKeydown = (e: KeyboardEvent) => {
        const input = e.target as HTMLInputElement;
        
        // Only handle Enter key for vertical spacing input
        if (e.key === 'Enter') {
            e.preventDefault();
            const value = input.value.trim();
            if (value === '' || isNaN(parseFloat(value))) {
                input.value = '7.5';
                WordBox.updateVerticalSpacing(7.5);
            } else {
                const numValue = parseFloat(value);
                WordBox.updateVerticalSpacing(Math.min(7.5, numValue));
            }
            input.blur();
            return;
        }
        
        // Allow: backspace, delete, tab, escape, enter, decimal point, minus sign
        if ([46, 8, 9, 27, 13, 110, 190, 189].indexOf(e.keyCode) !== -1 ||
            // Allow: Ctrl+A
            (e.keyCode === 65 && e.ctrlKey === true) ||
            // Allow: home, end, left, right
            (e.keyCode >= 35 && e.keyCode <= 39) ||
            // Allow numbers
            (e.keyCode >= 48 && e.keyCode <= 57) ||
            // Allow numpad numbers
            (e.keyCode >= 96 && e.keyCode <= 105)) {
            return;
        }
        e.preventDefault();
    };

    glueInput.addEventListener('input', handleGlueInput);
    glueInput.addEventListener('blur', handleGlueBlur);
    glueInput.addEventListener('keydown', handleGlueKeydown);

    verticalSpacingInput.addEventListener('input', handleVerticalSpacingInput);
    verticalSpacingInput.addEventListener('blur', handleVerticalSpacingBlur);
    verticalSpacingInput.addEventListener('keydown', handleVerticalSpacingKeydown);

    // Add change event listeners for DPI and page dimensions
    dpiInput.addEventListener('change', () => {
        updatePageDimensions();
        // After dimensions are updated, we need to update margins to maintain their relative positions
        const dpi = parseInt(dpiInput.value);
        if (!isNaN(dpi)) {
            canvasManager.updateMarginsFromInputs({
                top: marginTopInput.value,
                right: marginRightInput.value,
                bottom: marginBottomInput.value,
                left: marginLeftInput.value
            });
        }
    });
    widthInput.addEventListener('change', () => {
        updatePageDimensions();
        // After dimensions are updated, we need to update the right margin to maintain its relative position
        const dpi = parseInt(dpiInput.value);
        if (!isNaN(dpi)) {
            canvasManager.updateMarginsFromInputs({
                top: marginTopInput.value,
                right: marginRightInput.value,
                bottom: marginBottomInput.value,
                left: marginLeftInput.value
            });
        }
    });
    heightInput.addEventListener('change', () => {
        updatePageDimensions();
        // After dimensions are updated, we need to update the bottom margin to maintain its relative position
        const dpi = parseInt(dpiInput.value);
        if (!isNaN(dpi)) {
            canvasManager.updateMarginsFromInputs({
                top: marginTopInput.value,
                right: marginRightInput.value,
                bottom: marginBottomInput.value,
                left: marginLeftInput.value
            });
        }
    });

    // Update reset button handler to include vertical spacing
    resetButton.addEventListener('click', () => {
        // Reset to default values
        dpiInput.value = '96';
        widthInput.value = '8.5';
        heightInput.value = '11';
        marginTopInput.value = '0.75';
        marginRightInput.value = '0.75';
        marginBottomInput.value = '0.75';
        marginLeftInput.value = '0.75';
        glueInput.value = '3';
        verticalSpacingInput.value = '7.5';
        WordBox.updateVerticalSpacing(7.5);

        // Update both dimensions and margins
        updatePageDimensions();
        canvasManager.updateMarginsFromInputs({
            top: marginTopInput.value,
            right: marginRightInput.value,
            bottom: marginBottomInput.value,
            left: marginLeftInput.value
        });
    });
}

// Function to serialize document state
function serializeDocument(): DocumentState {
    const pages: PageState[] = [];
    
    document.querySelectorAll('.canvas-container').forEach((pageContainer, pageIndex) => {
        const pageNumber = pageIndex + 1;
        const lines = canvasManager.getTextLines().get(pageNumber) || [];
        
        const lineStates: LineState[] = lines.map(line => ({
            id: line.getId(), // Add line ID for reconstruction
            pageNumber: line.getPageNumber(),
            yPosition: line.getYPosition(),
            bodyHeight: line.getBodyHeight()
        }));

        const wordBoxes = Array.from(pageContainer.querySelectorAll('[id^="wordbox-"]')).map(box => {
            const wordBox = box as HTMLElement;
            const rect = wordBox.querySelector('.wordbox-rect') as HTMLElement;
            const wordBoxInstance = WordBox.fromElement(wordBox);
            
            // Get metadata from the WordBox instance if it exists
            const metadata = wordBoxInstance ? {
                parentId: wordBoxInstance.getParentId(),
                childBoxIdTop: wordBoxInstance.getChildBoxIdTop(),
                childBoxIdBottom: wordBoxInstance.getChildBoxIdBottom(),
                lineId: wordBoxInstance.getLineId()
            } : {
                parentId: wordBox.dataset.parentId,
                childBoxIdTop: wordBox.dataset.childBoxIdTop,
                childBoxIdBottom: wordBox.dataset.childBoxIdBottom,
                lineId: wordBox.dataset.lineId
            };

            return {
                id: wordBox.id,
                text: rect.textContent || '',
                x: parseInt(wordBox.style.left),
                y: parseInt(wordBox.style.top),
                width: rect.getBoundingClientRect().width,  // Add width
                metadata: '', // Reserved for future use
                lineId: metadata.lineId,
                parentId: metadata.parentId,
                childBoxIdBottom: metadata.childBoxIdBottom,
                childBoxIdTop: metadata.childBoxIdTop,
                selected: wordBoxInstance?.isSelected() || false,
                individuallySelected: wordBoxInstance?.isIndividuallySelected() || false,
                lastNavigatedFromTop: wordBoxInstance?.getLastNavigatedFromTop() || false,
                lastNavigatedFromBottom: wordBoxInstance?.getLastNavigatedFromBottom() || false,
                isGreekText: wordBoxInstance?.getIsGreekText() || false,
                isChapter: wordBoxInstance?.getIsChapter() || false,
                isSection: wordBoxInstance?.getIsSection() || false,
                isHeadline: wordBoxInstance?.getIsHeadline() || false
            };
        });

        // Get marginalia for this page
        const marginalia = Array.from(pageContainer.querySelectorAll('[id^="marginalia-"]')).map(box => {
            const marginaliaBox = box as HTMLElement;
            const marginaliaInstance = Marginalia.fromElement(marginaliaBox);
            return marginaliaInstance ? marginaliaInstance.getState() : null;
        }).filter((state): state is NonNullable<typeof state> => state !== null);

        pages.push({
            pageNumber,
            lines: lineStates,
            wordBoxes,
            marginalia
        });
    });

    // Get the current page parameters
    const pageParams = {
        dpi: canvasManager.getCurrentDPI(),
        pageWidth: canvasManager.getCurrentPageWidth(),
        pageHeight: canvasManager.getCurrentPageHeight(),
        margins: canvasManager.getGlobalMargins()
    };

    // Get any UI state parameters
    const uiState = {
        linesAreVisible: WordBox.linesAreVisible,
        horizontalSpacing: (document.getElementById('glue-input') as HTMLInputElement)?.value || '3',
        verticalSpacing: (document.getElementById('vertical-spacing-input') as HTMLInputElement)?.value || '7.5',
        primaryLanguage: (document.getElementById('primary-language') as HTMLSelectElement)?.value || 'english',
        secondaryLanguage: (document.getElementById('secondary-language') as HTMLSelectElement)?.value || 'english',
        documentTitle: (document.getElementById('document-title') as HTMLTextAreaElement)?.value || '',
        documentAuthor: (document.getElementById('document-author') as HTMLTextAreaElement)?.value || '',
        documentTranslator: (document.getElementById('document-translator') as HTMLTextAreaElement)?.value || '',
        documentNotes: (document.getElementById('document-notes') as HTMLTextAreaElement)?.value || '',
        marginChecks: {
            top: (document.getElementById('margin-top-check') as HTMLInputElement)?.checked || false,
            right: (document.getElementById('margin-right-check') as HTMLInputElement)?.checked || false,
            bottom: (document.getElementById('margin-bottom-check') as HTMLInputElement)?.checked || false,
            left: (document.getElementById('margin-left-check') as HTMLInputElement)?.checked || false
        }
    };

    return {
        version: '1.0', // Add version for future compatibility
        pageParameters: pageParams,
        uiState,
        pages,
        lexicon: Lexicon.getInstance().toJSON() // Add lexicon data
    };
}

// Function to save document
async function saveDocument(): Promise<boolean> {
    try {
        const documentState = serializeDocument();
        const success = await window.electronAPI.saveDocument(
            JSON.stringify(documentState),
            currentDocumentName || undefined
        );
        if (success) {
            // Extract the document name from the saved file path
            const filePath = await window.electronAPI.getLastSavedPath();
            if (filePath) {
                // Extract just the filename without extension and store it
                const match = filePath.match(/([^/\\]+)\.andron$/);
                if (match) {
                    currentDocumentName = match[1];
                    console.log('Document saved successfully as:', currentDocumentName);
                }
            }
            // Add a save operation to the history stack
            historyManager.addOperation(historyManager.createSaveOperation());
            updateModifiedState();
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error saving document:', error);
        return false;
    }
}

// Function to load document
async function loadDocument() {
    try {
        const result = await window.electronAPI.openDocument();
        if (result) {
            const { data, filePath } = result;
            const documentState: DocumentState = JSON.parse(data);

            // Extract and store the document name
            const match = filePath.match(/([^/\\]+)\.andron$/);
            if (match) {
                currentDocumentName = match[1];
                console.log('Document opened:', currentDocumentName);
                // Set window title immediately
                document.title = `📜 Andron - ${currentDocumentName}`;
            }

            // Clear existing content
            const mainContent = document.getElementById('main-content');
            if (mainContent) {
                mainContent.innerHTML = '';
            }

            // Reset WordBox instances and history
            WordBox.instances.clear();
            historyManager.clearHistory();

            // Load lexicon data if available
            if (documentState.lexicon) {
                Lexicon.fromJSON(JSON.stringify(documentState.lexicon));
            }

            // Update UI state
            const primaryLanguageSelect = document.getElementById('primary-language') as HTMLSelectElement;
            const secondaryLanguageSelect = document.getElementById('secondary-language') as HTMLSelectElement;
            const verticalSpacingInput = document.getElementById('vertical-spacing-input') as HTMLInputElement;
            const glueInput = document.getElementById('glue-input') as HTMLInputElement;

            if (primaryLanguageSelect) {
                primaryLanguageSelect.value = documentState.uiState.primaryLanguage || 'english';
            }
            if (secondaryLanguageSelect) {
                secondaryLanguageSelect.value = documentState.uiState.secondaryLanguage || 'english';
            }
            if (verticalSpacingInput) {
                verticalSpacingInput.value = documentState.uiState.verticalSpacing || '7.5';
                WordBox.updateVerticalSpacing(parseFloat(verticalSpacingInput.value));
            }
            if (glueInput) {
                glueInput.value = documentState.uiState.horizontalSpacing || '3';
            }

            // Restore document info fields
            const documentTitle = document.getElementById('document-title') as HTMLTextAreaElement;
            const documentAuthor = document.getElementById('document-author') as HTMLTextAreaElement;
            const documentTranslator = document.getElementById('document-translator') as HTMLTextAreaElement;
            const documentNotes = document.getElementById('document-notes') as HTMLTextAreaElement;

            if (documentTitle) {
                documentTitle.value = documentState.uiState.documentTitle || '';
                adjustTextAreaHeight(documentTitle);
            }
            if (documentAuthor) {
                documentAuthor.value = documentState.uiState.documentAuthor || '';
                adjustTextAreaHeight(documentAuthor);
            }
            if (documentTranslator) {
                documentTranslator.value = documentState.uiState.documentTranslator || '';
                adjustTextAreaHeight(documentTranslator);
            }
            if (documentNotes) {
                documentNotes.value = documentState.uiState.documentNotes || '';
                adjustTextAreaHeight(documentNotes);
            }

            // Update canvas manager with page parameters
            canvasManager.updateDimensionsForDPI(documentState.pageParameters.dpi);
            canvasManager.updateDimensionsForInches(
                documentState.pageParameters.pageWidth / documentState.pageParameters.dpi,
                documentState.pageParameters.pageHeight / documentState.pageParameters.dpi
            );
            canvasManager.setGlobalMargins(documentState.pageParameters.margins);

            // Restore margin checkbox states
            const marginTopCheck = document.getElementById('margin-top-check') as HTMLInputElement;
            const marginRightCheck = document.getElementById('margin-right-check') as HTMLInputElement;
            const marginBottomCheck = document.getElementById('margin-bottom-check') as HTMLInputElement;
            const marginLeftCheck = document.getElementById('margin-left-check') as HTMLInputElement;

            if (marginTopCheck) marginTopCheck.checked = documentState.uiState.marginChecks.top;
            if (marginRightCheck) marginRightCheck.checked = documentState.uiState.marginChecks.right;
            if (marginBottomCheck) marginBottomCheck.checked = documentState.uiState.marginChecks.bottom;
            if (marginLeftCheck) marginLeftCheck.checked = documentState.uiState.marginChecks.left;

            // Update all margins to reflect the restored checkbox states
            canvasManager.updateAllMargins();

            // Create maps to store lines and boxes for quick lookup
            const lineMap = new Map<string, TextLine>();
            const boxMap = new Map<string, WordBox>();

            // First pass: Create pages and lines
            for (const pageState of documentState.pages) {
                // Create the page
                const { canvas, wrapper } = canvasManager.createPage();
                wrapper.dataset.pageNumber = pageState.pageNumber.toString();

                // Create lines with their original IDs and positions
                for (const lineState of pageState.lines) {
                    const line = canvasManager.addTextLine(pageState.pageNumber, lineState.yPosition);
                    lineMap.set(lineState.id, line);
                }

                // First create all boxes without setting up relationships
                for (const boxState of pageState.wordBoxes) {
                    // Determine if this box is a child box and what type
                    const isTopChild = !!boxState.parentId && !!pageState.wordBoxes.find(parent => parent.id === boxState.parentId && parent.childBoxIdTop === boxState.id);
                    const isBottomChild = !!boxState.parentId && !!pageState.wordBoxes.find(parent => parent.id === boxState.parentId && parent.childBoxIdBottom === boxState.id);

                    // Get the canvas for proper scaling
                    const canvasEl = wrapper.querySelector('canvas');
                    if (!canvasEl) continue;

                    const rect = canvasEl.getBoundingClientRect();
                    const scaleX = canvasEl.width / rect.width;
                    const scaleY = canvasEl.height / rect.height;

                    // Calculate screen coordinates
                    const screenX = boxState.x;
                    const screenY = boxState.y;

                    // Get the appropriate language setting based on whether it's a child box
                    const isGreek = isTopChild || isBottomChild ? 
                        documentState.uiState.secondaryLanguage === 'ancient-greek' :
                        documentState.uiState.primaryLanguage === 'ancient-greek';

                    const wordBox = new WordBox(
                        screenX,
                        screenY,
                        boxState.text,
                        boxState.metadata,
                        isTopChild,
                        isBottomChild,
                        isGreek,
                        boxState.isChapter,
                        boxState.isSection,
                        boxState.isHeadline
                    );

                    // Get the original ID from the box state
                    const originalId = boxState.id;
                    
                    // Clear the existing instance with its auto-generated ID
                    const autoGeneratedId = wordBox.getId();
                    WordBox.instances.delete(autoGeneratedId);
                    
                    // Update the element's ID to match the original
                    const element = wordBox.getElement();
                    element.id = originalId;
                    
                    // Force the WordBox instance to use the original ID
                    Object.defineProperty(wordBox, 'id', {
                        value: originalId,
                        writable: false,
                        configurable: true
                    });
                    
                    // Add the instance to the maps with the original ID
                    WordBox.instances.set(originalId, wordBox);
                    boxMap.set(originalId, wordBox);
                    
                    wrapper.appendChild(element);
                }
            }

            // Second pass: Set up all relationships
            for (const pageState of documentState.pages) {
                for (const boxState of pageState.wordBoxes) {
                    const wordBox = boxMap.get(boxState.id);
                    if (!wordBox) {
                        console.warn(`Could not find box with ID ${boxState.id}`);
                        continue;
                    }

                    // Set up parent relationship
                    if (boxState.parentId) {
                        const parentBox = boxMap.get(boxState.parentId);
                        if (parentBox) {
                            // Set parent ID on child
                            wordBox.setParentId(boxState.parentId);
                            
                            // Find the parent's state to determine child relationships
                            const parentState = pageState.wordBoxes.find(box => box.id === boxState.parentId);
                            if (parentState) {
                                // If we're the parent's top child
                                if (parentState.childBoxIdTop === boxState.id) {
                                    parentBox.setChildBoxIdTop(boxState.id);
                                }
                                // If we're the parent's bottom child
                                if (parentState.childBoxIdBottom === boxState.id) {
                                    parentBox.setChildBoxIdBottom(boxState.id);
                                }
                            }
                        } else {
                            console.warn(`Could not find parent box with ID ${boxState.parentId}`);
                        }
                    }

                    // Set up child relationships
                    if (boxState.childBoxIdTop) {
                        const childBox = boxMap.get(boxState.childBoxIdTop);
                        if (childBox) {
                            wordBox.setChildBoxIdTop(boxState.childBoxIdTop);
                            childBox.setParentId(boxState.id);
                        } else {
                            console.warn(`Could not find top child box with ID ${boxState.childBoxIdTop}`);
                        }
                    }
                    if (boxState.childBoxIdBottom) {
                        const childBox = boxMap.get(boxState.childBoxIdBottom);
                        if (childBox) {
                            wordBox.setChildBoxIdBottom(boxState.childBoxIdBottom);
                            childBox.setParentId(boxState.id);
                        } else {
                            console.warn(`Could not find bottom child box with ID ${boxState.childBoxIdBottom}`);
                        }
                    }

                    // Restore navigation states
                    if (boxState.lastNavigatedFromTop) {
                        wordBox.setLastNavigatedFromTop(true);
                    }
                    if (boxState.lastNavigatedFromBottom) {
                        wordBox.setLastNavigatedFromBottom(true);
                    }
                }
            }

            // Third pass: Restore line attachments and visual states
            for (const pageState of documentState.pages) {
                for (const boxState of pageState.wordBoxes) {
                    const wordBox = boxMap.get(boxState.id);
                    if (!wordBox) continue;

                    // Only process root boxes (those without parents)
                    if (!boxState.parentId) {
                        // First position the box at its saved coordinates
                        const element = wordBox.getElement();
                        element.style.left = `${boxState.x}px`;
                        element.style.top = `${boxState.y}px`;

                        // If it has a lineId, attach it to that line
                        if (boxState.lineId) {
                            const line = lineMap.get(boxState.lineId);
                            if (line) {
                                line.addWordBox(wordBox);
                            }
                        } else {
                            // Check if the box is near any line
                            const pageContainer = element.closest('.canvas-container') as HTMLElement;
                            if (pageContainer) {
                                const canvas = pageContainer.querySelector('canvas');
                                if (canvas) {
                                    const rect = canvas.getBoundingClientRect();
                                    const containerRect = pageContainer.getBoundingClientRect();
                                    const scaleY = canvas.height / rect.height;
                                    
                                    // Get all lines on this page
                                    const pageNumber = parseInt(pageContainer.dataset.pageNumber || '1');
                                    const lines = canvasManager.getTextLines().get(pageNumber) || [];
                                    
                                    // Find the closest line
                                    let minDistance = Infinity;
                                    let closestLine: TextLine | null = null;
                                    
                                    const boxRect = element.getBoundingClientRect();
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
                                        closestLine.addWordBox(wordBox);
                                    }
                                }
                            }
                            // Update positions of any children
                            updateChildBoxPosition(wordBox);
                        }
                    }

                    // Restore selection states
                    if (boxState.selected) {
                        wordBox.setSelected(true);
                    }
                    if (boxState.individuallySelected) {
                        wordBox.setIndividuallySelected(true);
                        const element = wordBox.getElement();
                        if (element) {
                            currentlyHighlightedBox = element;
                        }
                    }
                }
            }

            // Apply line visibility state to all elements
            document.querySelectorAll('.wordbox').forEach(box => {
                box.classList.toggle('lines-hidden', !WordBox.linesAreVisible);
            });

            // Restore marginalia
            for (const pageState of documentState.pages) {
                const pageContainer = document.querySelector(`[data-page-number="${pageState.pageNumber}"]`);
                if (!pageContainer) continue;

                // Create and restore each marginalia box
                for (const marginaliaState of pageState.marginalia || []) {
                    const marginalia = new Marginalia(marginaliaState.x, marginaliaState.y);
                    
                    // Force the marginalia instance to use the original ID
                    const element = marginalia.getElement();
                    const autoGeneratedId = element.id;
                    element.id = marginaliaState.id;
                    Marginalia.updateInstanceId(autoGeneratedId, marginaliaState.id, marginalia);

                    // Restore text and dimensions
                    marginalia.setText(marginaliaState.text);
                    marginalia.setDimensions(marginaliaState.width, marginaliaState.height);

                    // Restore Greek text if needed
                    if (marginaliaState.isGreekText) {
                        const textArea = element.querySelector('textarea');
                        if (textArea) {
                            textArea.style.fontFamily = 'New Athena Unicode, Arial Unicode MS, Lucida Grande, sans-serif';
                        }
                    }

                    pageContainer.appendChild(element);
                }
            }

            // Update thumbnails after loading
            canvasManager.updateThumbnails();

            // Add a save operation to mark the initial state
            historyManager.addOperation(historyManager.createSaveOperation());
            
            // Reset modified state since we just loaded the document
            isDocumentModified = false;
            // Update the window title after loading
            updateModifiedState();
        }
    } catch (error) {
        console.error('Error loading document:', error);
    }
}

function getConnectedBoxWidths(parentBox: WordBox): { id: string; width: number; text: string; }[] {
    // Get all connected boxes (parent and children)
    const connectedBoxes = getAllConnectedBoxes(parentBox);
    
    // Map each box to its width information
    return connectedBoxes.map(box => {
        const element = box.getElement();
        const rect = element.querySelector('.wordbox-rect') as HTMLElement;
        const textWidth = rect.getBoundingClientRect().width - 8; // Subtract 8px for padding only
        
        return {
            id: box.getId(),
            width: textWidth, // Use exact text width without minimum
            text: rect.textContent || ''
        };
    });
}

// Export the function
export { getConnectedBoxWidths };

// Add after other functions
async function exportPdf() {
    try {
        const documentState = serializeDocument();
        // If we have a stored document name, use it as default filename
        const defaultName = currentDocumentName ? `${currentDocumentName}.pdf` : undefined;
        const success = await window.electronAPI.exportPdf(JSON.stringify(documentState), defaultName);
        if (success) {
            console.log('PDF exported successfully');
        }
    } catch (error) {
        console.error('Error exporting PDF:', error);
    }
}

// Add after exportPdf function
async function exportLatex() {
    const documentData = JSON.stringify(serializeDocument());
    const defaultName = currentDocumentName || 'andron_document';
    await window.electronAPI.exportLatex(documentData, defaultName);
}

// Function for creating a new document
async function newDocument() {
    // 1. Check if there are unsaved changes
    if (isDocumentModified) {
        // Ask user if they want to save changes with Yes/No/Cancel options using custom modal
        const saveChoice = await showModal(
            'Save Changes?',
            'There are unsaved changes in the current document. Do you want to save before creating a new document?'
        );
        
        if (saveChoice === 'yes') {
            // User chose "Yes" - Save the current document
            const saveSuccess = await saveDocument();
            // If save was cancelled or failed, abort new document creation
            if (!saveSuccess) {
                console.log('New document creation cancelled - save operation was not completed');
                return;
            }
        } else if (saveChoice === 'no') {
            // User chose "No" - Confirm they want to discard changes
            const discardChoice = await showModal(
                'Discard Changes?',
                'Are you sure you want to discard unsaved changes and create a new document?',
                false // Only show Yes/Cancel buttons
            );
            
            if (discardChoice !== 'yes') {
                // User cancelled - Abort new document creation
                console.log('New document creation cancelled by user');
                return;
            }
            // User confirmed discard - Continue with new document
            console.log('Continuing without saving changes');
        } else {
            // User chose "Cancel" - Abort new document creation
            console.log('New document creation cancelled by user');
            return;
        }
    }
    
    // 2. Clear the current document name
    currentDocumentName = null;
    
    // 3. Update the window title
    document.title = '📜 Andron';
    
    // 4. Clear existing content
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
        mainContent.innerHTML = '';
    }
    
    // 5. Reset WordBox instances and history
    WordBox.instances.clear();
    historyManager.clearHistory();
    
    // 6. Reset UI state to defaults
    const primaryLanguageSelect = document.getElementById('primary-language') as HTMLSelectElement;
    const secondaryLanguageSelect = document.getElementById('secondary-language') as HTMLSelectElement;
    const verticalSpacingInput = document.getElementById('vertical-spacing-input') as HTMLInputElement;
    const glueInput = document.getElementById('glue-input') as HTMLInputElement;
    const dpiInput = document.getElementById('dpi-input') as HTMLInputElement;
    const widthInput = document.getElementById('width-input') as HTMLInputElement;
    const heightInput = document.getElementById('height-input') as HTMLInputElement;
    const marginTopInput = document.getElementById('margin-top') as HTMLInputElement;
    const marginRightInput = document.getElementById('margin-right') as HTMLInputElement;
    const marginBottomInput = document.getElementById('margin-bottom') as HTMLInputElement;
    const marginLeftInput = document.getElementById('margin-left') as HTMLInputElement;
    const documentTitle = document.getElementById('document-title') as HTMLTextAreaElement;
    const documentAuthor = document.getElementById('document-author') as HTMLTextAreaElement;
    const documentTranslator = document.getElementById('document-translator') as HTMLTextAreaElement;
    const documentNotes = document.getElementById('document-notes') as HTMLTextAreaElement;
    
    // Reset form fields to default values
    if (primaryLanguageSelect) primaryLanguageSelect.value = 'english';
    if (secondaryLanguageSelect) secondaryLanguageSelect.value = 'english';
    if (verticalSpacingInput) {
        verticalSpacingInput.value = '7.5';
        WordBox.updateVerticalSpacing(7.5);
    }
    if (glueInput) glueInput.value = '3';
    if (dpiInput) dpiInput.value = '96';
    if (widthInput) widthInput.value = '8.5';
    if (heightInput) heightInput.value = '11';
    if (marginTopInput) marginTopInput.value = '0.75';
    if (marginRightInput) marginRightInput.value = '0.75';
    if (marginBottomInput) marginBottomInput.value = '0.75';
    if (marginLeftInput) marginLeftInput.value = '0.75';
    
    // Reset margin checkboxes
    const marginTopCheck = document.getElementById('margin-top-check') as HTMLInputElement;
    const marginRightCheck = document.getElementById('margin-right-check') as HTMLInputElement;
    const marginBottomCheck = document.getElementById('margin-bottom-check') as HTMLInputElement;
    const marginLeftCheck = document.getElementById('margin-left-check') as HTMLInputElement;
    if (marginTopCheck) marginTopCheck.checked = false;
    if (marginRightCheck) marginRightCheck.checked = false;
    if (marginBottomCheck) marginBottomCheck.checked = false;
    if (marginLeftCheck) marginLeftCheck.checked = false;
    
    // Update margin lines to reflect checkbox changes
    canvasManager.updateAllMargins();
    
    // Clear document info fields
    if (documentTitle) {
        documentTitle.value = '';
        adjustTextAreaHeight(documentTitle);
    }
    if (documentAuthor) {
        documentAuthor.value = '';
        adjustTextAreaHeight(documentAuthor);
    }
    if (documentTranslator) {
        documentTranslator.value = '';
        adjustTextAreaHeight(documentTranslator);
    }
    if (documentNotes) {
        documentNotes.value = '';
        adjustTextAreaHeight(documentNotes);
    }
    
    // Reset page dimensions and margins
    canvasManager.updateDimensionsForDPI(96);
    canvasManager.updateDimensionsForInches(8.5, 11);
    canvasManager.updateMarginsFromInputs({
        top: '0.75',
        right: '0.75',
        bottom: '0.75',
        left: '0.75'
    });
    
    // 7. Create a new blank page
    const { canvas, wrapper } = canvasManager.createPage();
    wrapper.setAttribute('tabindex', '-1');
    wrapper.style.outline = 'none';
    
    // 8. Update thumbnails
    canvasManager.updateThumbnails();
    
    // 9. Reset modified state
    isDocumentModified = false;
    updateModifiedState();
    
    console.log('New document created');
}

// Add menu event handlers
window.electronAPI.onMenuNew(() => {
    newDocument();
});

window.electronAPI.onMenuOpen(() => {
    loadDocument();
});

window.electronAPI.onMenuSave(() => {
    saveDocument();
});

window.electronAPI.onMenuExportPdf(() => {
    exportPdf();
});

window.electronAPI.onMenuExportLatex(() => {
    exportLatex();
});

// Add after exportLatex function
async function exportLexicon() {
    try {
        // Send the raw lexicon object, not a JSON string
        const lexiconObject = Lexicon.getInstance().toJSON();
        const defaultName = currentDocumentName ? `${currentDocumentName}_lexicon.json` : 'lexicon.json';
        const success = await window.electronAPI.exportLexicon(lexiconObject, defaultName);
        if (success) {
            console.log('Lexicon exported successfully');
        }
    } catch (error) {
        console.error('Error exporting lexicon:', error);
    }
}

window.electronAPI.onMenuExportLexicon(() => {
    exportLexicon();
});