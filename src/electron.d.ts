interface ElectronAPI {
    saveDocument: (documentData: string, defaultName?: string, saveAs?: boolean) => Promise<boolean>;
    openDocument: () => Promise<{ data: string; filePath: string } | null>;
    exportPdf: (documentData: string, defaultName?: string) => Promise<boolean>;
    exportLatex: (documentData: string, defaultName?: string) => Promise<boolean>;
    exportLexicon: (lexiconData: object, defaultName?: string) => Promise<boolean>;
    getLastSavedPath: () => Promise<string | null>;
    onMenuNew: (callback: () => void) => void;
    onMenuOpen: (callback: () => void) => void;
    onMenuSave: (callback: () => void) => void;
    onMenuSaveAs: (callback: () => void) => void;
    onMenuExportPdf: (callback: () => void) => void;
    onMenuExportLatex: (callback: () => void) => void;
    onMenuExportLexicon: (callback: () => void) => void;
    onCheckUnsavedChanges: (callback: () => void) => void;
    confirmClose: (shouldClose: boolean) => void;
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
} 