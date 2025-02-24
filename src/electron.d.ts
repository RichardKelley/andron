interface ElectronAPI {
    saveDocument: (documentData: string) => Promise<boolean>;
    openDocument: () => Promise<{ data: string; filePath: string } | null>;
    exportPdf: (documentData: string, defaultName?: string) => Promise<boolean>;
    exportLatex: (documentData: string, defaultName?: string) => Promise<boolean>;
    getLastSavedPath: () => Promise<string | null>;
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
} 