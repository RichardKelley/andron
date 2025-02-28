// Shared margin state
export interface MarginState {
    left: number;
    right: number;
    top: number;
    bottom: number;
}


// Add at the top with other interfaces
export interface DocumentState {
    version: string;
    pageParameters: PageParameters;
    uiState: UIState;
    pages: PageState[];
    lexicon?: any[];
}

export interface PageState {
    pageNumber: number;
    lines: LineState[];
    wordBoxes: WordBoxState[];
    marginalia: MarginaliaState[];
}

export interface LineState {
    id: string;
    pageNumber: number;
    yPosition: number;
    bodyHeight: number;
}

export interface WordBoxState {
    id: string;
    text: string;
    x: number;
    y: number;
    width: number;
    metadata: string;
    lineId?: string;
    parentId?: string;
    childBoxIdBottom?: string;
    childBoxIdTop?: string;
    selected: boolean;
    individuallySelected: boolean;
    lastNavigatedFromTop: boolean;
    lastNavigatedFromBottom: boolean;
    isGreekText: boolean;
    isChapter: boolean;
    isSection: boolean;
    isHeadline: boolean;
}

export interface PageParameters {
    dpi: number;
    pageWidth: number;
    pageHeight: number;
    margins: MarginState;
}

export interface UIState {
    linesAreVisible: boolean;
    horizontalSpacing: string;
    verticalSpacing: string;
    primaryLanguage: string;
    secondaryLanguage: string;
    documentTitle: string;
    documentAuthor: string;
    documentTranslator: string;
    documentNotes: string;
    marginChecks: {
        top: boolean;
        right: boolean;
        bottom: boolean;
        left: boolean;
    };
}

export interface MarginaliaState {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
    isGreekText: boolean;
}
