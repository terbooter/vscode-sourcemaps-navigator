import * as Url from 'url';
import * as path from 'path';
import * as vscode from 'vscode';
import { Disposable, FileSystemWatcher, Range, TextDocument } from 'vscode';
import { SourceMapItem } from './sourceMapItem';
import { safeMethod } from './decorators';

export class SourceMapStore implements Disposable {
    private cache: { [generatedPath: string]: SourceMapItem } = {};
    /** A table for reverse lookup, i.e. to find map for file generated from this one */
    private reverseLookupTable: { [sourcePath: string]: string } = {};
    private watchers: { [path: string]: FileSystemWatcher } = {};
    private fetcher = new SourceMapFetcher();

    @safeMethod
    private addItem(item: SourceMapItem): void {
        this.cache[item.generatedFile] = item;
        this.watchers[item.generatedFile] = vscode.workspace.createFileSystemWatcher(item.generatedFile, true);
        this.watchers[item.generatedFile].onDidChange(() => this.removeItem(item.generatedFile));
        this.watchers[item.generatedFile].onDidDelete(() => this.removeItem(item.generatedFile));

        item.sourceFiles.forEach(sourceFile => this.reverseLookupTable[sourceFile] = item.generatedFile);
    }

    @safeMethod
    private removeItem(generatedPath: string): void {
        if (this.watchers[generatedPath]) {
            this.watchers[generatedPath].dispose();
            delete this.watchers[generatedPath];
        }

        if (this.cache[generatedPath]) {
            this.cache[generatedPath].sourceFiles.forEach(sourceFile => delete this.reverseLookupTable[sourceFile]);

            delete this.cache[generatedPath];
        }

    }

    private reverseLookup(sourceFileName: string): SourceMapItem | null {
        if (this.reverseLookupTable[sourceFileName]) {
            return this.cache[this.reverseLookupTable[sourceFileName]];
        }

        // tslint:disable-next-line:no-null-keyword
        return null;
    }

    public dispose() {
        Object.keys(this.cache).forEach(key => this.removeItem(key));
    }

    public async getForCurrentDocument(): Promise<SourceMapItem> {
        const currentDocument = vscode.window.activeTextEditor.document;
        const result =
            this.cache[currentDocument.fileName] ||
            this.reverseLookup(currentDocument.fileName);

        if (!result) {
            const item = await this.fetch(currentDocument);
            this.addItem(item);
            return item;
        }

        return result;
    }

    private async fetch(currentDocument: TextDocument): Promise<SourceMapItem> {
        let item: SourceMapItem;
        try {
            const { mapUrl, fileUrl } = this.fetcher.fetch(currentDocument);
            if (isDataUri(mapUrl)) {
                item = await SourceMapItem.fromDataUrl(mapUrl, fileUrl)
            } else {
                item = await SourceMapItem.fromFile(mapUrl);
            }
        } catch (err) {
            throw new Error(`Can't retrieve source maps for current document`);
        }

        return item;
    }
}

/**
 * Interface, describing fetched source map location
 */
interface SourceMapFetchResult {
    /**
     * Either data URL for inline source map or absolute
     * path to the file, where source map is stored.
     * @type {string}
     * @member SourceMapFetchResult
     */
    mapUrl: string;
    /**
     * Path to the generated file where the source map
     * is referenced from.
     * @type {string}
     * @member SourceMapFetchResult
     */
    fileUrl: string;
}

/**
 * Checks whether provided URL is data URI
 * @param {string} url URL to check
 * @returns {boolean}
 */
function isDataUri(url: string): boolean {
    return Url.parse(url).protocol === 'data:';
}

class SourceMapFetcher {

    private static SOURCE_MAPPING_MATCHER = new RegExp('^//[#@] ?sourceMappingURL=(.+)$');

    public fetch(document: TextDocument): SourceMapFetchResult {
        const lastTenLines = new Range(document.lineCount - 10, 0, document.lineCount + 1, 0);
        const fetchedMapUrl = document.getText(lastTenLines).split('\n')
            .reduceRight<string>((result, line) => {
                return result || this.tryExtractUrl(line);
            }, "");

        if (!fetchedMapUrl) {
            throw new Error(`Can't fetch url from current document at ${document.fileName}`);
        }

        const fileUrl = document.fileName;
        const mapUrl = isDataUri(fetchedMapUrl) ? fetchedMapUrl :
            path.resolve(path.dirname(fileUrl), fetchedMapUrl);

        return { mapUrl, fileUrl };
    }

    private tryExtractUrl(line: string): string {
        const matches = SourceMapFetcher.SOURCE_MAPPING_MATCHER.exec(line.trim());
        return matches && matches.length === 2 ? matches[1].trim() : "";
    }
}
