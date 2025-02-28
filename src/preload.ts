const { contextBridge, ipcRenderer } = require('electron');

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

// Expose any APIs to renderer here
contextBridge.exposeInMainWorld('electronAPI', {
    saveDocument: async (documentData: string, defaultName?: string) => {
        return await ipcRenderer.invoke('save-document', documentData, defaultName);
    },
    openDocument: () => ipcRenderer.invoke('open-document'),
    exportPdf: (documentData: string, defaultName?: string) => ipcRenderer.invoke('export-pdf', documentData, defaultName),
    exportLatex: (documentData: string, defaultName?: string) => ipcRenderer.invoke('export-latex', documentData, defaultName),
    exportLexicon: (lexiconData: object, defaultName?: string) => ipcRenderer.invoke('export-lexicon', lexiconData, defaultName),
    getLastSavedPath: () => ipcRenderer.invoke('get-last-saved-path'),
    onMenuNew: (callback: () => void) => ipcRenderer.on('menu-new', callback),
    onMenuOpen: (callback: () => void) => ipcRenderer.on('menu-open', callback),
    onMenuSave: (callback: () => void) => ipcRenderer.on('menu-save', callback),
    onMenuExportPdf: (callback: () => void) => ipcRenderer.on('menu-export-pdf', callback),
    onMenuExportLatex: (callback: () => void) => ipcRenderer.on('menu-export-latex', callback),
    onMenuExportLexicon: (callback: () => void) => ipcRenderer.on('menu-export-lexicon', callback)
} as ElectronAPI); 