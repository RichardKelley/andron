interface ElectronAPI {
    saveDocument: (documentData: string) => Promise<boolean>;
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

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
} 