export class LexicalEntry {
    private primaryText: string;
    private translations: Set<string>;
    private pageNumbers: Set<number>;

    constructor(primaryText: string) {
        this.primaryText = primaryText;
        this.translations = new Set<string>();
        this.pageNumbers = new Set<number>();
    }

    public addTranslation(translation: string): void {
        if (!translation || translation.trim() === '') {
            console.warn(`Attempted to add empty translation to '${this.primaryText}'`);
            return;
        }
        console.log(`Adding translation '${translation}' to '${this.primaryText}'`);
        this.translations.add(translation);
    }

    public removeTranslation(translation: string): void {
        this.translations.delete(translation);
    }

    public addPageNumber(pageNumber: number): void {
        this.pageNumbers.add(pageNumber);
    }

    public getTranslations(): string[] {
        const result = Array.from(this.translations);
        console.log(`Getting translations for '${this.primaryText}' - Found ${result.length}: ${result}`);
        return result;
    }

    public getPageNumbers(): number[] {
        return Array.from(this.pageNumbers).sort((a, b) => a - b);
    }

    public getPrimaryText(): string {
        return this.primaryText;
    }

    public toJSON(): any {
        return {
            primaryText: this.primaryText,
            translations: Array.from(this.translations),
            pageNumbers: Array.from(this.pageNumbers).sort((a, b) => a - b)
        };
    }

    public static fromJSON(json: any): LexicalEntry {
        if (!json.primaryText) {
            console.error('Invalid entry JSON - missing primaryText:', json);
            throw new Error('Invalid entry JSON - missing primaryText');
        }
        
        console.log(`Creating LexicalEntry from JSON for: ${json.primaryText}`);
        const entry = new LexicalEntry(json.primaryText);
        
        // Try to find translations in different possible formats
        // First check the standard 'translations' array
        if (json.translations && Array.isArray(json.translations)) {
            console.log(`Adding ${json.translations.length} translations from 'translations' array`);
            json.translations.forEach((t: string) => {
                console.log(`  - Adding translation: ${t}`);
                entry.addTranslation(t);
            });
        } 
        // Try alternative property names that might contain translations
        else if (json.translation && typeof json.translation === 'string') {
            // Single translation as a string
            console.log(`Adding single translation from 'translation' property: ${json.translation}`);
            entry.addTranslation(json.translation);
        }
        else if (json.english && typeof json.english === 'string') {
            // Some lexicon files might use 'english' as the key
            console.log(`Adding translation from 'english' property: ${json.english}`);
            entry.addTranslation(json.english);
        } 
        else if (json.meaning && typeof json.meaning === 'string') {
            // Some lexicon files might use 'meaning' as the key
            console.log(`Adding translation from 'meaning' property: ${json.meaning}`);
            entry.addTranslation(json.meaning);
        }
        else if (json.definition && typeof json.definition === 'string') {
            // Some lexicon files might use 'definition' as the key
            console.log(`Adding translation from 'definition' property: ${json.definition}`);
            entry.addTranslation(json.definition);
        }
        else {
            // Check if any property in the JSON could be a translation
            let foundTranslation = false;
            
            for (const key in json) {
                if (key !== 'primaryText' && key !== 'pageNumbers' && typeof json[key] === 'string') {
                    console.log(`Found potential translation in property '${key}': ${json[key]}`);
                    entry.addTranslation(json[key]);
                    foundTranslation = true;
                }
                // If the property is an array, check if it contains strings that could be translations
                else if (Array.isArray(json[key]) && json[key].length > 0 && typeof json[key][0] === 'string') {
                    console.log(`Found potential translations array in property '${key}':`, json[key]);
                    json[key].forEach((t: string) => {
                        if (typeof t === 'string') {
                            entry.addTranslation(t);
                        }
                    });
                    foundTranslation = true;
                }
            }
            
            if (!foundTranslation) {
                console.warn('No translations found in entry JSON:', json);
            }
        }
        
        // Add page numbers
        if (json.pageNumbers && Array.isArray(json.pageNumbers)) {
            json.pageNumbers.forEach((p: number) => entry.addPageNumber(p));
        }
        
        return entry;
    }
}

export class Lexicon {
    private static instance: Lexicon;
    private entries: Map<string, LexicalEntry>;
    private name: string;
    private static secondaryLexicons: Lexicon[] = [];
    private static initialized: boolean = false;
    
    constructor(name: string = 'Primary Lexicon') {
        this.entries = new Map<string, LexicalEntry>();
        this.name = name;
    }

    public static initialize(): void {
        if (!Lexicon.initialized) {
            Lexicon.instance = new Lexicon();
            Lexicon.initialized = true;
            console.log('Lexicon class initialized with primary lexicon');
        }
    }
    
    public static getInstance(): Lexicon {
        if (!Lexicon.instance) {
            Lexicon.initialize();
        }
        return Lexicon.instance;
    }
    
    public static getSecondaryLexicons(): Lexicon[] {
        return Lexicon.secondaryLexicons;
    }
    
    public static addSecondaryLexicon(lexicon: Lexicon): void {
        // Don't add duplicates by name
        if (!Lexicon.secondaryLexicons.some(l => l.getName() === lexicon.getName())) {
            Lexicon.secondaryLexicons.push(lexicon);
        }
    }
    
    public static removeSecondaryLexicon(lexiconName: string): void {
        Lexicon.secondaryLexicons = Lexicon.secondaryLexicons.filter(l => l.getName() !== lexiconName);
    }
    
    public static findEntryInAllLexicons(primaryText: string): { entry: LexicalEntry, source: Lexicon } | null {
        console.log(`---Looking for '${primaryText}' in all lexicons---`);
        
        // Ensure primary lexicon instance is initialized
        if (!Lexicon.instance) {
            console.log('Primary lexicon not initialized, initializing now');
            Lexicon.getInstance();
        }
        
        // First check primary lexicon
        const primaryLexicon = Lexicon.getInstance();
        console.log(`Checking primary lexicon: ${primaryLexicon.getName()} with ${primaryLexicon.getEntryCount()} entries`);
        
        const primaryEntry = primaryLexicon.getEntry(primaryText);
        if (primaryEntry) {
            console.log(`Found in primary lexicon: ${primaryLexicon.getName()}`);
            return { entry: primaryEntry, source: primaryLexicon };
        }
        
        // Then check all secondary lexicons in order
        console.log(`Not found in primary lexicon. Checking ${Lexicon.secondaryLexicons.length} secondary lexicons`);
        
        for (const lexicon of Lexicon.secondaryLexicons) {
            console.log(`Checking secondary lexicon: ${lexicon.getName()} with ${lexicon.getEntryCount()} entries`);
            const entry = lexicon.getEntry(primaryText);
            
            if (entry) {
                console.log(`Found in secondary lexicon: ${lexicon.getName()}`);
                console.log(`Entry has ${entry.getTranslations().length} translations: ${entry.getTranslations()}`);
                return { entry, source: lexicon };
            }
        }
        
        console.log(`Not found in any lexicon`);
        return null;
    }
    
    public static copyEntryToPrimary(primaryText: string, secondaryLexicon: Lexicon): void {
        console.log('Copying entry to primary lexicon:', primaryText);
        const entry = secondaryLexicon.getEntry(primaryText);
        if (!entry) {
            console.log('No entry found in secondary lexicon');
            return;
        }
        
        // Ensure primary lexicon instance is initialized
        if (!Lexicon.instance) {
            Lexicon.getInstance();
        }
        
        const primaryLexicon = Lexicon.getInstance();
        let primaryEntry = primaryLexicon.getEntry(primaryText);
        
        if (!primaryEntry) {
            console.log('Creating new entry in primary lexicon');
            primaryEntry = new LexicalEntry(primaryText);
            primaryLexicon.entries.set(primaryText, primaryEntry);
        }
        
        // Copy all translations
        entry.getTranslations().forEach(translation => {
            primaryEntry?.addTranslation(translation);
        });
        
        // Copy page numbers (optional)
        entry.getPageNumbers().forEach(pageNumber => {
            primaryEntry?.addPageNumber(pageNumber);
        });
    }
    
    public static mergeAllTranslations(primaryText: string): void {
        console.log(`Merging all translations for '${primaryText}' into primary lexicon`);
        
        // Ensure primary lexicon instance is initialized
        if (!Lexicon.instance) {
            Lexicon.getInstance();
        }
        
        const primaryLexicon = Lexicon.getInstance();
        let primaryEntry = primaryLexicon.getEntry(primaryText);
        
        if (!primaryEntry) {
            console.log('Creating new entry in primary lexicon');
            primaryEntry = new LexicalEntry(primaryText);
            primaryLexicon.entries.set(primaryText, primaryEntry);
        }
        
        // Go through all secondary lexicons
        for (const lexicon of Lexicon.secondaryLexicons) {
            const entry = lexicon.getEntry(primaryText);
            if (entry) {
                console.log(`Found entry in ${lexicon.getName()}, copying translations`);
                
                // Copy all translations
                entry.getTranslations().forEach(translation => {
                    console.log(`Copying translation: ${translation}`);
                    primaryEntry?.addTranslation(translation);
                });
                
                // Copy page numbers
                entry.getPageNumbers().forEach(pageNumber => {
                    primaryEntry?.addPageNumber(pageNumber);
                });
            }
        }
        
        console.log(`Primary lexicon entry now has ${primaryEntry.getTranslations().length} translations`);
    }

    public getName(): string {
        return this.name;
    }
    
    public setName(name: string): void {
        this.name = name;
    }

    public addEntry(primaryText: string, translation?: string, pageNumber?: number): LexicalEntry | null {
        // Skip if the text is "New Word" or empty
        if (primaryText === 'New Word' || !primaryText.trim()) {
            console.log('Skipping lexicon entry for "New Word" or empty string');
            return null;
        }

        let entry = this.entries.get(primaryText);
        if (!entry) {
            entry = new LexicalEntry(primaryText);
            this.entries.set(primaryText, entry);
        }
        
        // Skip empty translations
        if (translation && translation !== 'New Word' && translation.trim()) {
            entry.addTranslation(translation);
        }
        
        if (pageNumber) {
            entry.addPageNumber(pageNumber);
        }
        return entry;
    }

    public getEntry(primaryText: string): LexicalEntry | undefined {
        console.log(`Looking for entry '${primaryText}' in lexicon '${this.name}'`);
        console.log(`Lexicon has ${this.entries.size} entries`);
        
        // Check if entry exists
        const entry = this.entries.get(primaryText);
        
        if (entry) {
            console.log(`Found entry for '${primaryText}' with ${entry.getTranslations().length} translations`);
        } else {
            console.log(`No entry found for '${primaryText}' in lexicon '${this.name}'`);
            
            // For debugging, show what entries do exist
            if (this.entries.size > 0) {
                console.log('Available entries:', Array.from(this.entries.keys()).slice(0, 5));
            }
        }
        
        return entry;
    }
    
    public getEntryCount(): number {
        return this.entries.size;
    }
    
    public getAllEntries(): LexicalEntry[] {
        return Array.from(this.entries.values());
    }

    public toJSON(): any {
        return {
            name: this.name,
            entries: Array.from(this.entries.values()).map(entry => entry.toJSON())
        };
    }

    public static fromJSON(json: string | object): Lexicon {
        let parsed;
        try {
            if (typeof json === 'string') {
                console.log('Parsing string JSON:', json.substring(0, 200) + '...');
                parsed = JSON.parse(json);
            } else {
                console.log('Using provided JSON object');
                parsed = json;
            }
            
            console.log('Parsed lexicon data:', parsed);
            
            if (!parsed || typeof parsed !== 'object') {
                throw new Error('Invalid lexicon data: not an object');
            }
            
            if (!parsed.entries || !Array.isArray(parsed.entries)) {
                throw new Error('Invalid lexicon data: missing entries array');
            }
            
            const name = parsed.name || 'Imported Lexicon';
            console.log('Creating lexicon with name:', name);
            const lexicon = new Lexicon(name);
            
            let entryCount = 0;
            parsed.entries.forEach((entryJson: any) => {
                try {
                    const entry = LexicalEntry.fromJSON(entryJson);
                    lexicon.entries.set(entry.getPrimaryText(), entry);
                    entryCount++;
                } catch (error) {
                    console.error('Error parsing lexicon entry:', error, entryJson);
                }
            });
            
            console.log(`Successfully created lexicon with ${entryCount} entries`);
            return lexicon;
        } catch (error: any) {
            console.error('Error parsing lexicon JSON:', error);
            throw new Error(`Failed to parse lexicon data: ${error.message || 'Unknown error'}`);
        }
    }
} 