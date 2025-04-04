const { contextBridge, ipcRenderer } = require('electron');

// Using the ElectronAPI interface declared in electron.d.ts

// Define the API type inline for the preload context
type PreloadElectronAPI = {
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
    onShowHelpModal: (callback: () => void) => void;
    confirmClose: (shouldClose: boolean) => void;
};

// Expose any APIs to renderer here
contextBridge.exposeInMainWorld('electronAPI', {
    saveDocument: async (documentData: string, defaultName?: string, saveAs?: boolean) => {
        return await ipcRenderer.invoke('save-document', documentData, defaultName, saveAs);
    },
    openDocument: () => ipcRenderer.invoke('open-document'),
    exportPdf: (documentData: string, defaultName?: string) => ipcRenderer.invoke('export-pdf', documentData, defaultName),
    exportLatex: (documentData: string, defaultName?: string) => ipcRenderer.invoke('export-latex', documentData, defaultName),
    exportLexicon: (lexiconData: object, defaultName?: string) => ipcRenderer.invoke('export-lexicon', lexiconData, defaultName),
    getLastSavedPath: () => ipcRenderer.invoke('get-last-saved-path'),
    onMenuNew: (callback: () => void) => ipcRenderer.on('menu-new', callback),
    onMenuOpen: (callback: () => void) => ipcRenderer.on('menu-open', callback),
    onMenuSave: (callback: () => void) => ipcRenderer.on('menu-save', callback),
    onMenuSaveAs: (callback: () => void) => ipcRenderer.on('menu-save-as', callback),
    onMenuExportPdf: (callback: () => void) => ipcRenderer.on('menu-export-pdf', callback),
    onMenuExportLatex: (callback: () => void) => ipcRenderer.on('menu-export-latex', callback),
    onMenuExportLexicon: (callback: () => void) => ipcRenderer.on('menu-export-lexicon', callback),
    onCheckUnsavedChanges: (callback: () => void) => ipcRenderer.on('check-unsaved-changes', callback),
    onShowHelpModal: (callback: () => void) => ipcRenderer.on('show-help-modal', callback),
    confirmClose: (shouldClose: boolean) => ipcRenderer.send('confirm-close', shouldClose)
} as PreloadElectronAPI); 