import { app, BrowserWindow, ipcMain, dialog, Menu, MenuItemConstructorOptions } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { PageState, WordBoxState, LineState } from './interfaces.js';
import PDFDocument from 'pdfkit';
import { createWriteStream } from 'fs';
import { CAP_HEIGHT, ASCENDER_HEIGHT } from './constants.js';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let lastSavedPath: string | null = null;

function createWindow() {
    // Create the browser window with more conservative settings
    const mainWindow = new BrowserWindow({
        width: 1024,
        height: 768,
        title: '📜 Andron',
        icon: path.join(__dirname, '../assets/icons/icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: true,
            devTools: true,
            javascript: true,
            backgroundThrottling: false
        },
        show: false,
        backgroundColor: '#ffffff'
    });

    // Add close event handler to check for unsaved changes
    mainWindow.on('close', (e) => {
        // Prevent the default close behavior
        e.preventDefault();
        // Send a message to the renderer to check for unsaved changes
        mainWindow.webContents.send('check-unsaved-changes');
    });

    // Create the application menu
    const template: MenuItemConstructorOptions[] = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'New',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => {
                        mainWindow.webContents.send('menu-new');
                    }
                },
                {
                    label: 'Open...',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => {
                        mainWindow.webContents.send('menu-open');
                    }
                },
                {
                    label: 'Save',
                    accelerator: 'CmdOrCtrl+S',
                    click: () => {
                        mainWindow.webContents.send('menu-save');
                    }
                },
                {
                    label: 'Save As...',
                    accelerator: 'CmdOrCtrl+Shift+S',
                    click: () => {
                        mainWindow.webContents.send('menu-save-as');
                    }
                },
                { type: 'separator' },
                {
                    label: 'Exit',
                    click: () => {
                        app.quit();
                    }
                }
            ]
        },
        {
            label: 'Export',
            submenu: [
                {
                    label: 'Export as PDF...',
                    click: () => {
                        mainWindow.webContents.send('menu-export-pdf');
                    }
                },
                {
                    label: 'Export as LaTeX...',
                    click: () => {
                        mainWindow.webContents.send('menu-export-latex');
                    }
                },
                {
                    label: 'Export Lexicon as JSON...',
                    click: () => {
                        mainWindow.webContents.send('menu-export-lexicon');
                    }
                }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'delete' },
                { type: 'separator' },
                { role: 'selectAll' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Keyboard Shortcuts',
                    accelerator: 'h',
                    click: () => {
                        mainWindow.webContents.send('show-help-modal');
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);

    // Add error handler
    mainWindow.webContents.on('render-process-gone', (event, details) => {
        console.error('Renderer process gone:', details);
    });

    mainWindow.webContents.on('did-fail-load', () => {
        console.error('Renderer process failed to load');
    });

    // Load the index.html file
    mainWindow.loadFile(path.join(__dirname, 'index.html'))
        .catch(err => {
            console.error('Failed to load index.html:', err);
        });

    // Maximize the window before showing it
    mainWindow.maximize();

    // Show window only when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    return mainWindow;
}

// When Electron has finished initialization
app.whenReady().then(() => {
    // Set conservative memory limits
    app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');
    
    const mainWindow = createWindow();

    // Handle window creation for macOS
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });

    // Add error handler for the main process
    process.on('uncaughtException', (error) => {
        console.error('Uncaught exception in main process:', error);
    });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
    app.quit();
});

// Add IPC handlers for file operations
ipcMain.handle('save-document', async (event, documentData, defaultName, saveAs) => {
    // If we have a saved path and saveAs is not true, directly save without dialog
    if (lastSavedPath && !saveAs) {
        try {
            await fs.writeFile(lastSavedPath, documentData, 'utf-8');
            return true;
        } catch (error) {
            console.error('Error saving document:', error);
            return false;
        }
    } else {
        // Show dialog for first save or "Save As..."
        const { filePath, canceled } = await dialog.showSaveDialog({
            defaultPath: defaultName ? `${defaultName}.andron` : 
                         lastSavedPath ? lastSavedPath : undefined,
            filters: [
                { name: 'Andron Document', extensions: ['andron'] }
            ],
            properties: ['createDirectory']
        });

        if (filePath && !canceled) {
            try {
                await fs.writeFile(filePath, documentData, 'utf-8');
                lastSavedPath = filePath;
                return true;
            } catch (error) {
                console.error('Error saving document:', error);
                return false;
            }
        }
        return false;
    }
});

ipcMain.handle('get-last-saved-path', async () => {
    return lastSavedPath;
});

ipcMain.handle('open-document', async () => {
    const { filePaths } = await dialog.showOpenDialog({
        filters: [
            { name: 'Andron Document', extensions: ['andron'] }
        ],
        properties: ['openFile']
    });

    if (filePaths && filePaths[0]) {
        const data = await fs.readFile(filePaths[0], 'utf-8');
        lastSavedPath = filePaths[0];
        return { data, filePath: filePaths[0] };
    }
    return null;
});

// Add PDF export handler
ipcMain.handle('export-pdf', async (event, documentData, defaultName) => {
    const { filePath } = await dialog.showSaveDialog({
        defaultPath: defaultName,
        filters: [
            { name: 'PDF Document', extensions: ['pdf'] }
        ],
        properties: ['createDirectory']
    });

    if (filePath) {
        try {
            // Parse the document data
            const data = JSON.parse(documentData);
            
            // Convert pixels to points (1 point = 1/72 inch)
            const pixelsToPoints = (pixels: number) => {
                return Math.round((pixels / data.pageParameters.dpi) * 72);
            };
            
            // Calculate page dimensions in points
            const pageWidth = pixelsToPoints(data.pageParameters.pageWidth);
            const pageHeight = pixelsToPoints(data.pageParameters.pageHeight);
            
            // Create a new PDF document
            const doc = new PDFDocument({
                size: [pageWidth, pageHeight],
                margins: {
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: 0
                },
                autoFirstPage: false
            });

            // Register and embed the Noto Serif font
            doc.registerFont('NotoSerif', path.join(__dirname, '../assets/fonts/NotoSerif-Regular.ttf'));
            doc.font('NotoSerif');

            // Calculate base font size in points (assuming 12pt at 96 DPI)
            const baseFontSize = Math.round(12 * (72 / 96));
            doc.fontSize(baseFontSize);

            // Pipe the PDF to a file
            const writeStream = createWriteStream(filePath);
            doc.pipe(writeStream);

            // Add pages and content
            for (const page of data.pages) {
                // Add a new page
                doc.addPage();

                // Draw margin lines if checked
                const margins = data.pageParameters.margins;
                const marginChecks = data.uiState.marginChecks || {};

                // Save graphics state
                doc.save();
                doc.lineWidth(0.5);  // Set line width to 0.5 points

                // Draw margin lines
                if (marginChecks.top) {
                    doc.moveTo(pixelsToPoints(margins.left), pixelsToPoints(margins.top))
                       .lineTo(pixelsToPoints(margins.right), pixelsToPoints(margins.top))
                       .stroke();
                }
                if (marginChecks.right) {
                    doc.moveTo(pixelsToPoints(margins.right), pixelsToPoints(margins.top))
                       .lineTo(pixelsToPoints(margins.right), pixelsToPoints(margins.bottom))
                       .stroke();
                }
                if (marginChecks.bottom) {
                    doc.moveTo(pixelsToPoints(margins.left), pixelsToPoints(margins.bottom))
                       .lineTo(pixelsToPoints(margins.right), pixelsToPoints(margins.bottom))
                       .stroke();
                }
                if (marginChecks.left) {
                    doc.moveTo(pixelsToPoints(margins.left), pixelsToPoints(margins.top))
                       .lineTo(pixelsToPoints(margins.left), pixelsToPoints(margins.bottom))
                       .stroke();
                }

                // Restore graphics state
                doc.restore();

                // Add word boxes
                for (const box of page.wordBoxes) {
                    const x = pixelsToPoints(box.x);
                    const y = pixelsToPoints(box.y);

                    // Save the current graphics state
                    doc.save();

                    // Apply chapter styling if needed
                    if (box.isChapter) {
                        doc.fontSize(baseFontSize * 1.5);
                        doc.font('NotoSerif');
                    } else if (box.isSection) {
                        doc.fontSize(baseFontSize * 1.25);
                        doc.font('NotoSerif');
                    } else {
                        doc.fontSize(baseFontSize);
                        doc.font('NotoSerif');
                    }

                    doc.text(box.text, x, y, {
                        lineBreak: false,
                        baseline: 'top'
                    });

                    // Restore the graphics state
                    doc.restore();
                }

                // Add marginalia text
                for (const note of page.marginalia) {
                    // Calculate positions in points - use exact position without additional padding
                    const x = pixelsToPoints(note.x);
                    const y = pixelsToPoints(note.y);
                    const width = pixelsToPoints(note.width);
                    
                    // Skip if no text content
                    if (!note.text || note.text.trim() === '') {
                        continue;
                    }

                    // Save the current graphics state
                    doc.save();
                    
                    // Move to the correct position and set up text rendering
                    doc.fontSize(Math.round(10 * 72 / data.pageParameters.dpi));
                    if (note.isGreekText) {
                        doc.font('NotoSerif');
                    }

                    // Draw text directly with text wrapping
                    const words = note.text.split(/\s+/);
                    let currentLine = '';
                    let yOffset = 0;
                    const lineHeight = doc.currentLineHeight();
                    // Add 2pt padding to match UI
                    const xWithPadding = x + 2;
                    const yWithPadding = y + 2;

                    for (const word of words) {
                        const testLine = currentLine + (currentLine ? ' ' : '') + word;
                        const testWidth = doc.widthOfString(testLine);

                        if (testWidth > width - 4 && currentLine) {  // Subtract 4pt for left and right padding
                            // Draw the current line
                            doc.text(currentLine, xWithPadding, yWithPadding + yOffset, {
                                lineBreak: false,
                                baseline: 'top'
                            });
                            currentLine = word;
                            yOffset += lineHeight;
                        } else {
                            currentLine = testLine;
                        }
                    }

                    // Draw the last line
                    if (currentLine) {
                        doc.text(currentLine, xWithPadding, yWithPadding + yOffset, {
                            lineBreak: false,
                            baseline: 'top'
                        });
                    }

                    // Restore the graphics state
                    doc.restore();
                }
            }

            // Finalize the PDF
            doc.end();

            // Wait for the write stream to finish
            await new Promise<void>((resolve, reject) => {
                writeStream.on('finish', () => resolve());
                writeStream.on('error', reject);
            });

            return true;
        } catch (error) {
            console.error('Error in PDF export:', error);
            return false;
        }
    }
    return false;
});

// Add LaTeX export handler
ipcMain.handle('export-latex', async (event, documentData, defaultName) => {
    const { filePath } = await dialog.showSaveDialog({
        defaultPath: defaultName,
        filters: [
            { name: 'LaTeX Document', extensions: ['tex'] }
        ],
        properties: ['createDirectory']
    });

    if (filePath) {
        try {
            // Parse the document data
            const data = JSON.parse(documentData);
            
            // Convert pixels to points (1 point = 1/72 inch)
            const pixelsToPoints = (pixels: number) => {
                return (pixels / data.pageParameters.dpi * 72.27).toFixed(2); // LaTeX uses 72.27 pt/inch
            };
            
            // Calculate page dimensions in points
            const pageWidth = pixelsToPoints(data.pageParameters.pageWidth);
            const pageHeight = pixelsToPoints(data.pageParameters.pageHeight);
            const margins = data.pageParameters.margins;
            const marginChecks = data.uiState.marginChecks || {};

            // Generate LaTeX document
            let latexContent = `\\documentclass[12pt]{article}
\\usepackage[paperwidth=${pageWidth}pt,paperheight=${pageHeight}pt,margin=0pt]{geometry}
\\usepackage[greek,english]{babel}
\\usepackage{teubner}
\\usepackage[absolute,overlay]{textpos}
\\usepackage{calc}
\\usepackage{marginnote}
\\usepackage{ragged2e}
\\usepackage{tikz}
\\usepackage{xcolor}

% Set up textpos for absolute positioning
\\setlength{\\TPHorizModule}{1pt}
\\setlength{\\TPVertModule}{1pt}
\\textblockorigin{0pt}{0pt}

% Define margin line drawing commands
\\newcommand{\\drawmarginlines}{%
  \\begin{tikzpicture}[remember picture,overlay,shift={(current page.north west)}]
    \\begin{scope}[line width=0.5pt]
      ${marginChecks.top ? `\\draw[black] (${pixelsToPoints(margins.left)}pt,-${pixelsToPoints(margins.top)}pt) -- (${pixelsToPoints(margins.right)}pt,-${pixelsToPoints(margins.top)}pt);` : ''}
      ${marginChecks.right ? `\\draw[black] (${pixelsToPoints(margins.right)}pt,-${pixelsToPoints(margins.top)}pt) -- (${pixelsToPoints(margins.right)}pt,-${pixelsToPoints(margins.bottom)}pt);` : ''}
      ${marginChecks.bottom ? `\\draw[black] (${pixelsToPoints(margins.left)}pt,-${pixelsToPoints(margins.bottom)}pt) -- (${pixelsToPoints(margins.right)}pt,-${pixelsToPoints(margins.bottom)}pt);` : ''}
      ${marginChecks.left ? `\\draw[black] (${pixelsToPoints(margins.left)}pt,-${pixelsToPoints(margins.top)}pt) -- (${pixelsToPoints(margins.left)}pt,-${pixelsToPoints(margins.bottom)}pt);` : ''}
    \\end{scope}
  \\end{tikzpicture}%
}

% Remove page numbers
\\pagestyle{empty}

\\begin{document}

% Ensure content starts at the correct position
\\noindent%
`;

            // Add pages and content
            for (const page of data.pages) {
                latexContent += '% New page\n';
                if (page.pageNumber > 1) {
                    latexContent += '\\clearpage\n';
                }
                latexContent += '\\noindent%\n\\drawmarginlines%\n\n';

                // Group word boxes by line ID and store line y-coordinates
                const boxesByLine = new Map<string | undefined, WordBoxState[]>();
                const lineYCoordinates = new Map<string, number>();

                // First pass: Group boxes and find minimum y-coordinate for each line
                page.wordBoxes.forEach((box: WordBoxState) => {
                    const lineId = box.lineId;
                    if (!boxesByLine.has(lineId)) {
                        boxesByLine.set(lineId, []);
                        if (lineId) {
                            // Initialize with the first box's y-coordinate
                            lineYCoordinates.set(lineId, parseFloat(pixelsToPoints(box.y)));
                        }
                    } else if (lineId) {
                        // Update with minimum y-coordinate
                        const currentY = lineYCoordinates.get(lineId) || 0;
                        const boxY = parseFloat(pixelsToPoints(box.y));
                        lineYCoordinates.set(lineId, Math.min(currentY, boxY));
                    }
                    boxesByLine.get(lineId)?.push(box);
                });

                // Process boxes line by line
                boxesByLine.forEach((boxes: WordBoxState[], lineId: string | undefined) => {
                    if (lineId) {
                        // Use the stored y-coordinate for this line
                        const lineY = lineYCoordinates.get(lineId);
                        if (!lineY) return; // Skip if no y-coordinate found
                        
                        boxes.forEach((box: WordBoxState) => {
                            const x = pixelsToPoints(box.x);
                            
                            // Determine font size and style based on box type
                            let fontSize = '';
                            if (box.isChapter) {
                                fontSize = '{\\Large\\bfseries ';
                            } else if (box.isSection) {
                                fontSize = '{\\large\\bfseries ';
                            }

                            // Escape special LaTeX characters
                            const escapedText = box.text
                                .replace(/\\/g, '\\textbackslash{}')
                                .replace(/([&%$#_{}~^])/g, '\\$1')
                                .replace(/\[/g, '{[}')
                                .replace(/\]/g, '{]}');

                            // Calculate the width of the text block
                            const textWidth = pixelsToPoints(box.width || 0);

                            // Calculate base vertical position from the line
                            let yPos = lineY;

                            // If this is a child box, adjust its position relative to its parent
                            if (box.parentId) {
                                const parentBox = boxes.find(b => b.id === box.parentId);
                                if (parentBox) {
                                    const isTopChild = parentBox.childBoxIdTop === box.id;
                                    const isBottomChild = parentBox.childBoxIdBottom === box.id;
                                    
                                    // Position based on whether it's a top or bottom child
                                    if (isTopChild) {
                                        // Position above parent with spacing
                                        const spacing = parseFloat(pixelsToPoints(parseFloat(data.uiState.verticalSpacing))); // Use document's vertical spacing
                                        const capHeight = parseFloat(pixelsToPoints(CAP_HEIGHT));
                                        yPos = yPos - spacing - capHeight;
                                    } else if (isBottomChild) {
                                        // Position below parent with spacing
                                        const spacing = parseFloat(pixelsToPoints(parseFloat(data.uiState.verticalSpacing))); // Use document's vertical spacing
                                        const capHeight = parseFloat(pixelsToPoints(CAP_HEIGHT));
                                        yPos = yPos + spacing + capHeight;
                                    }
                                }
                            }

                            // Calculate the final vertical position adjustment
                            const capHeight = parseFloat(pixelsToPoints(CAP_HEIGHT));
                            const ascenderHeight = parseFloat(pixelsToPoints(ASCENDER_HEIGHT));
                            const yAdjustment = -capHeight + ascenderHeight - parseFloat(pixelsToPoints(16));
                            const adjustedY = yPos + yAdjustment;

                            // Add Greek language switch if the text is Greek
                            const useSecondaryLanguage = box.isChapter || box.isSection || box.parentId;
                            const isGreek = useSecondaryLanguage ? 
                                data.uiState.secondaryLanguage === 'ancient-greek' :
                                box.isGreekText;
                            const langCommand = isGreek ? '{\\selectlanguage{greek}' : '';

                            latexContent += `\\begin{textblock*}{${textWidth}pt}(${x}pt, ${adjustedY}pt)
  \\raisebox{0pt}[0pt][0pt]{${fontSize}${langCommand}${escapedText}${langCommand ? '}' : ''}${fontSize ? '}' : ''}}
\\end{textblock*}\n\n`;
                        });
                    } else {
                        // For boxes not on a line (like chapters/sections), use their original y-coordinate
                        // Sort boxes to ensure parent boxes are processed before children
                        const sortedBoxes = [...boxes].sort((a, b) => {
                            // If one is a parent of the other, parent comes first
                            if (b.parentId === a.id) return -1;
                            if (a.parentId === b.id) return 1;
                            // Otherwise maintain original order
                            return 0;
                        });

                        // Keep track of parent positions to adjust child positions
                        const parentPositions = new Map<string, { x: number, y: number }>();

                        sortedBoxes.forEach(box => {
                            let xPos = parseFloat(pixelsToPoints(box.x));
                            let yPos = parseFloat(pixelsToPoints(box.y));
                            
                            // If this is a child box, adjust its position relative to its parent
                            if (box.parentId) {
                                const parentPos = parentPositions.get(box.parentId);
                                if (parentPos) {
                                    // Align x with parent
                                    xPos = parentPos.x;
                                    
                                    // Get the parent box to determine if this is a top or bottom child
                                    const parentBox = sortedBoxes.find(b => b.id === box.parentId);
                                    if (parentBox) {
                                        const isTopChild = parentBox.childBoxIdTop === box.id;
                                        const isBottomChild = parentBox.childBoxIdBottom === box.id;
                                        
                                        // Position based on whether it's a top or bottom child
                                        if (isTopChild) {
                                            // Position above parent with spacing
                                            const spacing = parseFloat(pixelsToPoints(parseFloat(data.uiState.verticalSpacing))); // Use document's vertical spacing
                                            const capHeight = parseFloat(pixelsToPoints(CAP_HEIGHT));
                                            yPos = parentPos.y - spacing - capHeight;
                                        } else if (isBottomChild) {
                                            // Position below parent with spacing
                                            const spacing = parseFloat(pixelsToPoints(parseFloat(data.uiState.verticalSpacing))); // Use document's vertical spacing
                                            const capHeight = parseFloat(pixelsToPoints(CAP_HEIGHT));
                                            yPos = parentPos.y + spacing + capHeight;
                                        }
                                    }
                                }
                            }
                            
                            let fontSize = '';
                            if (box.isChapter) {
                                fontSize = '{\\Large\\bfseries ';
                            } else if (box.isSection) {
                                fontSize = '{\\large\\bfseries ';
                            }

                            const escapedText = box.text
                                .replace(/\\/g, '\\textbackslash{}')
                                .replace(/([&%$#_{}~^])/g, '\\$1')
                                .replace(/\[/g, '{[}')
                                .replace(/\]/g, '{]}');

                            // Calculate the width of the text block
                            const textWidth = pixelsToPoints(box.width || 0);

                            // Add Greek language switch if the text is Greek
                            // Use secondary language for chapter/section boxes and child boxes
                            const useSecondaryLanguage = box.isChapter || box.isSection || box.parentId;
                            const isGreek = useSecondaryLanguage ? 
                                data.uiState.secondaryLanguage === 'ancient-greek' :
                                box.isGreekText;
                            const langCommand = isGreek ? '{\\selectlanguage{greek}' : '';

                            latexContent += `\\begin{textblock*}{${textWidth}pt}(${xPos}pt, ${yPos}pt)
  \\raisebox{0pt}[0pt][0pt]{${fontSize}${langCommand}${escapedText}${langCommand ? '}' : ''}${fontSize ? '}' : ''}}
\\end{textblock*}\n\n`;

                            // Store this box's position for its children
                            parentPositions.set(box.id, { x: xPos, y: yPos });
                        });
                    }
                });

                // Add marginalia
                for (const note of page.marginalia) {
                    if (!note.text || note.text.trim() === '') continue;

                    // Apply a horizontal correction to match UI positioning
                    // The value -20 is determined empirically to match the UI positioning
                    const x = pixelsToPoints(note.x - 20);
                    // Apply a vertical offset to move the text down
                    const y = pixelsToPoints(note.y + 20);
                    const width = pixelsToPoints(note.width);

                    // Escape special LaTeX characters in marginalia text
                    const escapedText = note.text
                        .replace(/\\/g, '\\textbackslash{}')
                        .replace(/([&%$#_{}~^])/g, '\\$1')
                        .replace(/\[/g, '{[}')
                        .replace(/\]/g, '{]}');

                    // Calculate the width of the text block (subtract padding)
                    const textWidth = parseFloat(width) - 4;

                    // Add Greek language switch if the text is Greek
                    const langCommand = note.isGreekText ? '{\\selectlanguage{greek}' : '';

                    // Use the same approach as wordboxes for consistency
                    latexContent += `\\begin{textblock*}{${width}pt}(${x}pt, ${y}pt)
  \\raisebox{0pt}[0pt][0pt]{\\small{\\hspace{2pt}\\parbox{${textWidth}pt}{${langCommand}${escapedText}${langCommand ? '}' : ''}}}}
\\end{textblock*}\n\n`;
                }
            }

            latexContent += '\\end{document}\n';

            // Write the LaTeX file
            await fs.writeFile(filePath, latexContent, 'utf8');
            return true;
        } catch (error) {
            console.error('Error in LaTeX export:', error);
            return false;
        }
    }
    return false;
});

// Add lexicon export handler
ipcMain.handle('export-lexicon', async (event, lexiconObject, defaultName) => {
    const { filePath } = await dialog.showSaveDialog({
        defaultPath: defaultName,
        filters: [
            { name: 'JSON Document', extensions: ['json'] }
        ],
        properties: ['createDirectory']
    });

    if (filePath) {
        try {
            // Write the object directly as JSON
            await fs.writeFile(filePath, JSON.stringify(lexiconObject, null, 2), 'utf-8');
            return true;
        } catch (error) {
            console.error('Error in lexicon export:', error);
            return false;
        }
    }
    return false;
});

// Add IPC handler for confirming application close
ipcMain.on('confirm-close', (event, shouldClose) => {
    if (shouldClose) {
        // If user confirmed to close, quit the application
        app.exit();
    }
    // If user cancelled, do nothing and the application will remain open
}); 