import * as path from 'path';
import * as vscode from 'vscode';
import { FilePosition } from './filePosition';
import { SourceMapConsumer, RawSourceMap } from 'source-map';
import { readFile } from './promisedFs';

export class SourceMapItem {
    public sourceFiles: string[];
    public generatedFile: string;
    private sourceMap: SourceMapConsumer;
    constructor(private rawSourceMap: RawSourceMap, private sourceMapFile: string) {
        this.sourceMap = new SourceMapConsumer(rawSourceMap);

        this.sourceFiles = rawSourceMap.sources
            .map(source => {
                return path.resolve(path.dirname(sourceMapFile), (rawSourceMap.sourceRoot || ""), source);
            });

        this.generatedFile = rawSourceMap.file ?
            path.resolve(path.dirname(sourceMapFile), rawSourceMap.file) :
            sourceMapFile;
    }

    public static async fromDataUrl(sourceMapUrl: string, sourceMapFile: string): Promise<SourceMapItem> {
        return new Promise<SourceMapItem>((resolve, reject) => {
            let sm: SourceMapItem;
            try {
                const data = sourceMapUrl.replace(/\r?\n/g, '').split(",")[1];
                sm = SourceMapItem.fromString(new Buffer(data, "base64").toString("utf8"), sourceMapFile);
            } catch (err) {
                reject(`Can't read source map from data URI`);
                return;
            }
            resolve(sm);
        });
    }

    public static async fromFile(sourceMapFile: string): Promise<SourceMapItem> {
        try {
            let fileContents = await readFile(sourceMapFile);
            return SourceMapItem.fromString(fileContents, sourceMapFile);
        } catch (err) {
            throw new Error(`Can't read source map from map file`);
        }
    }

    public static fromString(data: string, mapFile: string): SourceMapItem {
        try {
            const rawSourceMap = JSON.parse(data) as RawSourceMap;
            return new SourceMapItem(rawSourceMap, mapFile);
        } catch (err) {
            throw new Error(`Failed to create source map object from supplied JSON`);
        }
    }

    public isCurrentDocumentGenerated(): boolean {
        return this.generatedFile === vscode.window.activeTextEditor.document.fileName;
    }

    public generatedPositionFor(position: FilePosition): FilePosition {
        let result;
        try {
            const { file } = position;
            const absSourceRoot = path.resolve(path.dirname(this.sourceMapFile),
                (this.rawSourceMap.sourceRoot || ""));
            const source = path.relative(absSourceRoot, file);
            const smPosition = this.sourceMap.generatedPositionFor({ ...position.toSmPosition(), source });
            result = FilePosition.fromSmPosition({ ...smPosition, source: this.generatedFile });
        } catch (err) {
            throw new Error(`Failed to get generated position for original file`);
        }
        return result;
    }

    public originalPositionFor(position: FilePosition): FilePosition {
        let result;
        try {
            const smPosition = this.sourceMap.originalPositionFor(position.toSmPosition());
            const source = path.resolve(path.dirname(this.sourceMapFile), smPosition.source);
            result = FilePosition.fromSmPosition({ ...smPosition, source });

            const mapSourceIndex = this.rawSourceMap.sources.indexOf(smPosition.source);
            if (this.rawSourceMap.sourcesContent &&
                this.rawSourceMap.sourcesContent[mapSourceIndex]) {

                result.contents = this.rawSourceMap.sourcesContent[mapSourceIndex];
            }
        } catch (err) {
            throw new Error(`Failed to get original position for generated file`);
        }

        return result;
    }
}
