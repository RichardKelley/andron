// Import CAP_HEIGHT from constants
import { CAP_HEIGHT } from './constants.js';
import { Lexicon } from './lexicon.js';

export class WordBox {
    public static instances: Map<string, WordBox> = new Map();
    public static linesAreVisible: boolean = true;
    public static verticalSpacing: number = 7.5;  // Default vertical spacing
    private id: string;
    private x: number;
    private y: number;
    private text: string;
    private metadata: string;
    private height: number;
    private element: HTMLElement;
    private parentId?: string;
    private childBoxIdTop?: string;
    private childBoxIdBottom?: string;
    private lineId?: string;
    private selected: boolean = false;
    private individuallySelected: boolean = false;  // New property for individual selection
    private lastNavigatedFromTop: boolean = false;
    private lastNavigatedFromBottom: boolean = false;
    private isGreekText: boolean = false;
    private isChapter: boolean = false;  // Property for chapters
    private isSection: boolean = false;  // Property for sections
    private isTopChild: boolean = false;
    private isBottomChild: boolean = false;
    private isGreek: boolean = false;
    private isHeadline: boolean = false;  // New property for headlines

    constructor(x: number, y: number, text: string = 'New Word', metadata: string = '', 
        isTopChild: boolean = false, isBottomChild: boolean = false, isGreek: boolean = false, 
        isChapter: boolean = false, isSection: boolean = false, isHeadline: boolean = false) {
        this.id = `wordbox-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.x = x;
        this.y = y;
        this.text = text;
        this.metadata = metadata;
        this.isTopChild = isTopChild;
        this.isBottomChild = isBottomChild;
        this.isGreek = isGreek;
        this.isChapter = isChapter;
        this.isSection = isSection;
        this.isHeadline = isHeadline;
        this.height = isChapter ? CAP_HEIGHT * 1.5 : isSection ? CAP_HEIGHT * 1.25 : CAP_HEIGHT;  // 1.5x for chapters, 1.25x for sections
        
        // Set isGreekText based on whether it's a parent or child box
        const secondaryLanguageSelect = document.getElementById('secondary-language') as HTMLSelectElement;
        const isSecondaryGreek = secondaryLanguageSelect?.value === 'ancient-greek';
        
        if (isTopChild || isBottomChild || isHeadline) {
            this.isGreekText = isSecondaryGreek;
        } else {
            this.isGreekText = isGreek;
        }
        
        this.element = this.createHTMLElement(isTopChild, isBottomChild);
        
        // Add lines-hidden class if lines are currently hidden
        if (!WordBox.linesAreVisible) {
            this.element.classList.add('lines-hidden');
        }
        
        WordBox.instances.set(this.id, this);
        this.updateCssClasses(); // Initialize CSS classes based on state
    }

    // Static method to get WordBox instance from element
    public static fromElement(element: HTMLElement | null): WordBox | undefined {
        if (!element) return undefined;
        return WordBox.instances.get(element.id);
    }

    // Getters
    public getId(): string { return this.id; }
    public getElement(): HTMLElement { return this.element; }
    public getParentId(): string | undefined { return this.parentId; }
    public getChildBoxIdTop(): string | undefined { return this.childBoxIdTop; }
    public getChildBoxIdBottom(): string | undefined { return this.childBoxIdBottom; }
    public getLineId(): string | undefined { return this.lineId; }
    public getLeft(): number { return parseFloat(this.element.style.left) || 0; }
    public getWidth(): number { 
        const rect = this.element.querySelector('.wordbox-rect') as HTMLElement;
        return rect ? rect.getBoundingClientRect().width : 0;
    }
    public getX(): number { return this.x; }
    public getY(): number { return this.y; }

    // Setters
    public setParentId(id: string | undefined): void { 
        this.parentId = id; 
        if (id) {
            this.element.dataset.parentId = id;
        } else {
            delete this.element.dataset.parentId;
        }
    }
    
    public setChildBoxIdTop(id: string | undefined): void { 
        this.childBoxIdTop = id; 
        if (id) {
            this.element.dataset.childBoxIdTop = id;
            this.element.classList.add('has-child-top');
        } else {
            delete this.element.dataset.childBoxIdTop;
            this.element.classList.remove('has-child-top');
        }
    }
    
    public setChildBoxIdBottom(id: string | undefined): void { 
        this.childBoxIdBottom = id; 
        if (id) {
            this.element.dataset.childBoxIdBottom = id;
            this.element.classList.add('has-child-bottom');
        } else {
            delete this.element.dataset.childBoxIdBottom;
            this.element.classList.remove('has-child-bottom');
        }
    }
    
    public setLineId(id: string | undefined): void { 
        this.lineId = id;
        if (id) {
            this.element.dataset.lineId = id;
        } else {
            delete this.element.dataset.lineId;
        }
    }

    // Add getter and setter for selected state
    public isSelected(): boolean { return this.selected; }
    public setSelected(selected: boolean): void { 
        if (this.selected === selected) return; // Only update if state actually changes
        this.selected = selected; 
        this.updateCssClasses();
        
        // If this is a parent box with no individually selected child,
        // update the lexicon info when it's selected
        if (selected && !this.parentId) {
            const hasIndividuallySelectedChild = false;
            
            // Check if any child is individually selected
            if (this.childBoxIdTop) {
                const topChild = WordBox.fromElement(document.getElementById(this.childBoxIdTop));
                if (topChild && topChild.isIndividuallySelected()) {
                    return; // Don't update lexicon info if a child is already individually selected
                }
            }
            
            if (this.childBoxIdBottom) {
                const bottomChild = WordBox.fromElement(document.getElementById(this.childBoxIdBottom));
                if (bottomChild && bottomChild.isIndividuallySelected()) {
                    return; // Don't update lexicon info if a child is already individually selected
                }
            }
            
            // Update lexicon info if no child is individually selected
            const updateLexiconInfo = (window as any).updateLexiconInfo;
            if (typeof updateLexiconInfo === 'function') {
                updateLexiconInfo(this);
            }
        }
    }

    // Add getter and setter for individual selection state
    public isIndividuallySelected(): boolean { return this.individuallySelected; }
    public setIndividuallySelected(selected: boolean): void { 
        if (this.individuallySelected === selected) return; // Only update if state actually changes
        this.individuallySelected = selected; 
        this.updateCssClasses();
        
        // Update lexicon info in the sidebar when a wordbox is individually selected
        if (selected) {
            // Call the updateLexiconInfo function from renderer.ts
            const updateLexiconInfo = (window as any).updateLexiconInfo;
            if (typeof updateLexiconInfo === 'function') {
                updateLexiconInfo(this);
            }
        }
    }

    // Add getters and setters for navigation state
    public getLastNavigatedFromTop(): boolean { return this.lastNavigatedFromTop; }
    public getLastNavigatedFromBottom(): boolean { return this.lastNavigatedFromBottom; }
    public setLastNavigatedFromTop(value: boolean): void { this.lastNavigatedFromTop = value; }
    public setLastNavigatedFromBottom(value: boolean): void { this.lastNavigatedFromBottom = value; }
    public getIsGreekText(): boolean { return this.isGreekText; }
    public setIsGreekText(value: boolean): void { this.isGreekText = value; }

    // Add setters for x and y
    public setX(x: number): void { 
        this.x = x;
        this.element.style.left = `${x}px`;
    }

    public setY(y: number): void { 
        this.y = y;
        this.element.style.top = `${y}px`;
    }

    // Add method to update position from current style
    public updatePositionFromStyle(): void {
        this.x = parseFloat(this.element.style.left) || this.x;
        this.y = parseFloat(this.element.style.top) || this.y;
    }

    // New method to update CSS classes based on state
    private updateCssClasses(): void {
        // First remove all state-based classes
        this.element.classList.remove('selected', 'individually-selected');
        
        // Then add classes based on current state
        if (this.selected) {
            this.element.classList.add('selected');
        }
        if (this.individuallySelected) {
            this.element.classList.add('individually-selected');
        }
    }

    private createHTMLElement(isTopChild: boolean, isBottomChild: boolean): HTMLElement {
        const wordBox = document.createElement('div');
        wordBox.dataset.originalLineY = '';
        wordBox.dataset.snappedPageNumber = '';
        wordBox.dataset.childBoxIdBottom = '';
        wordBox.dataset.childBoxIdTop = '';
        wordBox.id = this.id;
        wordBox.className = 'wordbox';
        
        if (this.isChapter) {
            wordBox.classList.add('chapter');
        } else if (this.isSection) {
            wordBox.classList.add('section');
        } else if (this.isHeadline) {
            wordBox.classList.add('headline');
        }
        
        // Use direct positioning
        wordBox.style.left = `${this.x}px`;
        wordBox.style.top = `${this.y}px`;
        
        // Create container for the rectangle and text
        const rectContainer = document.createElement('div');
        rectContainer.className = 'wordbox-rect';
        rectContainer.textContent = this.text;
        
        // Set only the essential dimensions
        rectContainer.style.height = `${this.height}px`;
        rectContainer.style.lineHeight = `${this.height - 4}px`;
        
        // For chapters, sections, page numbers, or headlines, just add the rectangle without any lines or circles
        if (this.isChapter || this.isSection || this.text.match(/^\d+$/) || this.isHeadline) {
            wordBox.appendChild(rectContainer);
            // If it's a page number, add the page-number-box class and make it non-editable
            if (this.text.match(/^\d+$/)) {
                wordBox.classList.add('page-number-box');
                rectContainer.style.userSelect = 'none';
                rectContainer.setAttribute('data-non-editable', 'true');
                wordBox.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                });
            }
            return wordBox;
        }

        // Add appropriate lines and circles based on the box type
        if (isTopChild) {
            // Top child only gets top line and circle
            const topLine = document.createElement('div');
            topLine.className = 'wordbox-line-top';
            const topCircle = document.createElement('div');
            topCircle.className = 'wordbox-circle-top';
            
            wordBox.appendChild(topLine);
            wordBox.appendChild(topCircle);
            wordBox.appendChild(rectContainer);
        } else if (isBottomChild) {
            // Bottom child only gets bottom line and circle
            const bottomLine = document.createElement('div');
            bottomLine.className = 'wordbox-line-bottom';
            const bottomCircle = document.createElement('div');
            bottomCircle.className = 'wordbox-circle-bottom';
            
            wordBox.appendChild(bottomLine);
            wordBox.appendChild(bottomCircle);
            wordBox.appendChild(rectContainer);
        } else {
            // Regular box (not a child) gets both top and bottom
            const topLine = document.createElement('div');
            topLine.className = 'wordbox-line-top';
            const topCircle = document.createElement('div');
            topCircle.className = 'wordbox-circle-top';
            const bottomLine = document.createElement('div');
            bottomLine.className = 'wordbox-line-bottom';
            const bottomCircle = document.createElement('div');
            bottomCircle.className = 'wordbox-circle-bottom';

            wordBox.appendChild(topLine);
            wordBox.appendChild(topCircle);
            wordBox.appendChild(rectContainer);
            wordBox.appendChild(bottomLine);
            wordBox.appendChild(bottomCircle);
        }

        return wordBox;
    }

    // Static method to update vertical spacing
    public static updateVerticalSpacing(spacing: number): void {
        WordBox.verticalSpacing = spacing;
        document.documentElement.style.setProperty('--vertical-spacing', `${spacing}px`);
        
        // Update all connected boxes that have children or parents
        WordBox.instances.forEach(box => {
            if (box.getChildBoxIdTop() || box.getChildBoxIdBottom() || box.getParentId()) {
                updateChildBoxPosition(box);
            }
        });
    }

    public getIsChapter(): boolean { return this.isChapter; }
    public getIsSection(): boolean { return this.isSection; }
    public getIsHeadline(): boolean { return this.isHeadline; }

    // Change from private to public
    public updateLexicon(newText: string, oldText?: string): void {
        // Skip if the text is the default "New Word" or empty
        if (newText === 'New Word' || !newText.trim()) {
            return;
        }
        
        // Skip for special box types: Chapter, Section, and Headline boxes
        if (this.isChapter || this.isSection || this.isHeadline) {
            console.log(`Skipping lexicon update for ${this.isChapter ? 'Chapter' : this.isSection ? 'Section' : 'Headline'} box: "${newText}"`);
            return;
        }

        // Check if the box has a parent that's a special box type
        if (this.parentId) {
            const parentBox = WordBox.fromElement(document.getElementById(this.parentId));
            if (parentBox && (parentBox.getIsChapter() || parentBox.getIsSection() || parentBox.getIsHeadline())) {
                console.log(`Skipping lexicon update for child of ${parentBox.getIsChapter() ? 'Chapter' : parentBox.getIsSection() ? 'Section' : 'Headline'} box: "${newText}"`);
                return;
            }
        }

        const lexicon = Lexicon.getInstance();
        const pageContainer = this.element.closest('.canvas-container') as HTMLElement;
        if (!pageContainer) return;

        const pageNumber = parseInt(pageContainer.dataset.pageNumber || '1');

        // If this is a parent box
        if (!this.parentId) {
            // Add new word to lexicon with page number
            console.log(`Adding to lexicon: "${newText}" (page ${pageNumber})`);
            lexicon.addEntry(newText, undefined, pageNumber);

            // If this box has a child box, add its text as a translation
            if (this.childBoxIdBottom) {
                const childBox = WordBox.fromElement(document.getElementById(this.childBoxIdBottom));
                if (childBox) {
                    const childText = childBox.getElement().querySelector('.wordbox-rect')?.textContent;
                    if (childText && childText !== 'New Word' && childText.trim()) {
                        console.log(`Adding translation to lexicon: "${newText}" -> "${childText}"`);
                        lexicon.addEntry(newText, childText);
                    }
                }
            }
            if (this.childBoxIdTop) {
                const childBox = WordBox.fromElement(document.getElementById(this.childBoxIdTop));
                if (childBox) {
                    const childText = childBox.getElement().querySelector('.wordbox-rect')?.textContent;
                    if (childText && childText !== 'New Word' && childText.trim()) {
                        console.log(`Adding translation to lexicon: "${newText}" -> "${childText}"`);
                        lexicon.addEntry(newText, childText);
                    }
                }
            }
        }
        // If this is a child box
        else {
            // Get the parent box's text and add this as a translation
            const parentBox = WordBox.fromElement(document.getElementById(this.parentId));
            if (parentBox) {
                // Skip if the parent is a Chapter, Section, or Headline box
                if (parentBox.getIsChapter() || parentBox.getIsSection() || parentBox.getIsHeadline()) {
                    console.log(`Skipping lexicon update for child of ${parentBox.getIsChapter() ? 'Chapter' : parentBox.getIsSection() ? 'Section' : 'Headline'} box`);
                    return;
                }
                
                const parentText = parentBox.getElement().querySelector('.wordbox-rect')?.textContent;
                if (parentText && parentText !== 'New Word' && parentText.trim()) {
                    console.log(`Adding translation to lexicon from child: "${parentText}" -> "${newText}"`);
                    lexicon.addEntry(parentText, newText);
                }
            }
        }
    }

    // Add method to get suggested translation
    public getSuggestedTranslation(): string | undefined {
        // Only get suggestions for child boxes
        if (!this.parentId) {
            return undefined;
        }

        // Get the parent box's text
        const parentBox = WordBox.fromElement(document.getElementById(this.parentId));
        if (!parentBox) {
            return undefined;
        }

        const parentText = parentBox.getElement().querySelector('.wordbox-rect')?.textContent;
        if (!parentText) {
            return undefined;
        }

        // Look up the parent text in the lexicon
        const lexicon = Lexicon.getInstance();
        const entry = lexicon.getEntry(parentText);
        if (!entry) {
            return undefined;
        }

        // Return the first translation if available
        const translations = entry.getTranslations();
        return translations.length > 0 ? translations[0] : undefined;
    }

    // Add method to get translations for a parent box
    public getTranslationsForWord(): string[] | undefined {
        // Only get translations for parent boxes
        if (this.parentId) {
            return undefined;
        }

        const text = this.element.querySelector('.wordbox-rect')?.textContent;
        if (!text) {
            return undefined;
        }

        // Look up the text in the lexicon
        const lexicon = Lexicon.getInstance();
        const entry = lexicon.getEntry(text);
        if (!entry) {
            return undefined;
        }

        return entry.getTranslations();
    }
}


// Function to get all connected boxes (parent and children)
export const getAllConnectedBoxes = (box: WordBox): WordBox[] => {
    const connectedBoxes: Set<WordBox> = new Set([box]);
    
    // Function to recursively get all children
    const getAllChildren = (parentBox: WordBox) => {
        // Check bottom child
        const childIdBottom = parentBox.getChildBoxIdBottom();
        if (childIdBottom) {
            const childBox = WordBox.fromElement(document.getElementById(childIdBottom));
            if (childBox && !connectedBoxes.has(childBox)) {
                connectedBoxes.add(childBox);
                getAllChildren(childBox); // Recursively get child's children
            }
        }

        // Check top child
        const childIdTop = parentBox.getChildBoxIdTop();
        if (childIdTop) {
            const childBox = WordBox.fromElement(document.getElementById(childIdTop));
            if (childBox && !connectedBoxes.has(childBox)) {
                connectedBoxes.add(childBox);
                getAllChildren(childBox); // Recursively get child's children
            }
        }
    };

    // Function to recursively get all parents
    const getAllParents = (childBox: WordBox) => {
        const parentId = childBox.getParentId();
        if (parentId) {
            const parentBox = WordBox.fromElement(document.getElementById(parentId));
            if (parentBox && !connectedBoxes.has(parentBox)) {
                connectedBoxes.add(parentBox);
                getAllParents(parentBox); // Recursively get parent's parents
                getAllChildren(parentBox); // Get all children of each parent
            }
        }
    };

    // Get all connected boxes in both directions
    getAllParents(box);
    getAllChildren(box);
    
    return Array.from(connectedBoxes);
};


// Function to update child box position
export const updateChildBoxPosition = (parentBox: WordBox, forcedParentLeft?: number): void => {
    const childBoxIdBottom = parentBox.getChildBoxIdBottom();
    const childBoxIdTop = parentBox.getChildBoxIdTop();
    
    const updatePosition = (childId: string, isTop: boolean) => {
        const childBoxEl = document.getElementById(childId);
        if (!childBoxEl) return;
        
        const currentChildBox = WordBox.fromElement(childBoxEl);
        if (!currentChildBox) return;

        const parentElement = parentBox.getElement();
        const childElement = currentChildBox.getElement();

        // Use forced parent left if provided (during dragging), otherwise maintain current left position
        const newLeft = forcedParentLeft !== undefined ? 
            forcedParentLeft : 
            parseFloat(childElement.style.left) || 0;
        
        // For vertical position, use parent's actual top position
        const parentTop = parseFloat(parentElement.style.top) || 0;
        const y = isTop ? 
            parentTop - CAP_HEIGHT - WordBox.verticalSpacing : // Position above parent with spacing
            parentTop + CAP_HEIGHT + WordBox.verticalSpacing;  // Position below parent with spacing
        
        // Update child position
        childElement.style.left = `${newLeft}px`;
        childElement.style.top = `${y}px`;

        // If this child has its own children, update their positions
        if (currentChildBox.getChildBoxIdBottom() || currentChildBox.getChildBoxIdTop()) {
            updateChildBoxPosition(currentChildBox, newLeft);
        }
    };

    if (childBoxIdBottom) {
        updatePosition(childBoxIdBottom, false);
    }
    if (childBoxIdTop) {
        updatePosition(childBoxIdTop, true);
    }
};
