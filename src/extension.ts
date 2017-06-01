'use strict';

import * as vscode from 'vscode';
import { Selection, OutputChannel, TextEditor, TextDocument } from 'vscode';
import { FilePosition } from './filePosition';
import { SourceMapStore } from './sourceMapStore';
import { SourceMapLinkProvider } from './sourceMapLinkProvider';
import { SourceMapContentProvider } from './sourceMapContentProvider';
import { SourceMapItem } from "./sourceMapItem";

let sourceMapStore: SourceMapStore;
let outputChannel: OutputChannel;

/**
 * An utility function to get or create an output channel
 */
function getOutputChannel(): OutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel('Source maps');
    }

    return outputChannel;
}

export function activate(context: vscode.ExtensionContext) {
    sourceMapStore = new SourceMapStore();
    context.subscriptions.push(
        sourceMapStore,
        vscode.commands.registerCommand('smnavigator.navigate', navigate),
        vscode.languages.registerDocumentLinkProvider(
            ['javascript', 'javascriptreact'], new SourceMapLinkProvider()),
        vscode.workspace.registerTextDocumentContentProvider(
            'sourcemap', new SourceMapContentProvider())
    );
}

/**
 * The entry point for source maps navigation. Tries to fetch source maps from
 * current document (possibly using source map store's internal cache), determine
 * mapping direction (generated -> source and back), determine the target file to
 * open and then open it at respective position.
 *
 * In case of errors reports them via informational message and prints error trace
 * to output window.
 */
async function navigate() {
    try {
        const sm: SourceMapItem = await sourceMapStore.getForCurrentDocument();
        const activePosition = FilePosition.getActivePosition();
        let destinationPosition;
        if (sm.isCurrentDocumentGenerated()) {
            destinationPosition = sm.originalPositionFor(activePosition);
        } else {
            destinationPosition = sm.generatedPositionFor(activePosition);
        }
        await navigateToDestination(destinationPosition);
    } catch (err) {
        let message: string = typeof err === 'string' ? err :
            (err as Error).message;

        vscode.window.showWarningMessage(`Can\'t get source map for current document: ${message}`);
        getOutputChannel().appendLine(message);
        if (err instanceof Error && err.stack) {
            getOutputChannel().appendLine(err.stack);
        }
    }
}

async function navigateToDestination(destination: FilePosition): Promise<void> {
    let textDocument: TextDocument;
    try {
        textDocument = await vscode.workspace.openTextDocument(destination.file)
    } catch (err) {
        if (!destination.contents) {
            throw new Error(`Original source doesn't exist and source map doesn't provide inline source`);
        }

        const untitledFile = vscode.Uri.file(destination.file).with({ scheme: 'untitled' });
        textDocument = await vscode.workspace.openTextDocument(untitledFile);
    }

    let editor: TextEditor = await vscode.window.showTextDocument(textDocument);
    if (editor.document.isUntitled) {
        const builderOptions = { undoStopBefore: false, undoStopAfter: true };
        const callback = (builder: any) => {
            const wholeDoc = new vscode.Range(
                editor.document.positionAt(0),
                editor.document.positionAt(editor.document.getText().length)
            );
            return builder.replace(wholeDoc, destination.contents);
        }
        await editor.edit(callback, builderOptions)
    }

    editor.selection = new Selection(destination, destination);
    editor.revealRange(editor.selection, vscode.TextEditorRevealType.InCenter);
}
