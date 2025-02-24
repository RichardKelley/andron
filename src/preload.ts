const { contextBridge, ipcRenderer } = require('electron');

interface ElectronAPI {
    saveDocument: (documentData: string) => Promise<boolean>;
    openDocument: () => Promise<{ data: string; filePath: string } | null>;
    exportPdf: (documentData: string, defaultName?: string) => Promise<boolean>;
    exportLatex: (documentData: string, defaultName?: string) => Promise<boolean>;
    getLastSavedPath: () => Promise<string | null>;
}

// Expose any APIs to renderer here
contextBridge.exposeInMainWorld('electronAPI', {
    saveDocument: async (documentData: string, defaultName?: string) => {
        return await ipcRenderer.invoke('save-document', documentData, defaultName);
    },
    openDocument: () => ipcRenderer.invoke('open-document'),
    exportPdf: (documentData: string, defaultName?: string) => ipcRenderer.invoke('export-pdf', documentData, defaultName),
    exportLatex: (documentData: string, defaultName?: string) => ipcRenderer.invoke('export-latex', documentData, defaultName),
    getLastSavedPath: () => ipcRenderer.invoke('get-last-saved-path')
} as ElectronAPI); 