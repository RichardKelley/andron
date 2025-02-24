// Constants for page dimensions (in pixels)
export const DPI = 96; // Standard screen DPI
export const PAGE_WIDTH = 8.5 * DPI;  // 8.5 inches
export const PAGE_HEIGHT = 11 * DPI;  // 11 inches
export const PAGE_MARGIN = 0;  // Margin around the page for visual spacing
export const PAGE_GAP = 20;  // Gap between pages

// Default margin values (in pixels)
export const DEFAULT_MARGIN = DPI * 0.75;  // Standard 0.75-inch margin

// Constants for line dimensions (in pixels)
export const CAP_HEIGHT = Math.round(DPI * 0.25);   // Height from baseline to cap line (0.25 inches)
export const ASCENDER_HEIGHT = Math.round(DPI * 0.29);  // Height from baseline to top of ascenders (0.29 inches)
export const DESCENDER_HEIGHT = Math.round(DPI * 0.08);  // Height from baseline to bottom of descenders (0.08 inches)
export const BODY_HEIGHT = ASCENDER_HEIGHT + DESCENDER_HEIGHT;  // Total height of line
