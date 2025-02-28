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
        this.translations.add(translation);
    }

    public removeTranslation(translation: string): void {
        this.translations.delete(translation);
    }

    public addPageNumber(pageNumber: number): void {
        this.pageNumbers.add(pageNumber);
    }

    public getTranslations(): string[] {
        return Array.from(this.translations);
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
        const entry = new LexicalEntry(json.primaryText);
        json.translations.forEach((t: string) => entry.addTranslation(t));
        json.pageNumbers.forEach((p: number) => entry.addPageNumber(p));
        return entry;
    }
}

export class Lexicon {
    private static instance: Lexicon;
    private entries: Map<string, LexicalEntry>;

    private constructor() {
        this.entries = new Map<string, LexicalEntry>();
    }

    public static getInstance(): Lexicon {
        if (!Lexicon.instance) {
            Lexicon.instance = new Lexicon();
        }
        return Lexicon.instance;
    }

    public addEntry(primaryText: string, translation?: string, pageNumber?: number): LexicalEntry {
        let entry = this.entries.get(primaryText);
        if (!entry) {
            entry = new LexicalEntry(primaryText);
            this.entries.set(primaryText, entry);
        }
        if (translation) {
            entry.addTranslation(translation);
        }
        if (pageNumber) {
            entry.addPageNumber(pageNumber);
        }
        return entry;
    }

    public getEntry(primaryText: string): LexicalEntry | undefined {
        return this.entries.get(primaryText);
    }

    public toJSON(): any[] {
        const entriesArray = Array.from(this.entries.values()).map(entry => entry.toJSON());
        return entriesArray;
    }

    public static fromJSON(json: string): Lexicon {
        const instance = Lexicon.getInstance();
        const entriesArray = JSON.parse(json);
        entriesArray.forEach((entryJson: any) => {
            const entry = LexicalEntry.fromJSON(entryJson);
            instance.entries.set(entry.getPrimaryText(), entry);
        });
        return instance;
    }
} 