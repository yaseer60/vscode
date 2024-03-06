/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BugIndicatingError } from 'vs/base/common/errors';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';

export class TextEdit {
	constructor(public readonly edits: readonly SingleTextEdit[]) {
		// Sorting asc
	}

	mapPosition(position: Position): Position | Range {
		let lineDelta = 0;
		let curLine = 0;
		let columnDeltaInCurLine = 0;

		for (const edit of this.edits) {
			const start = edit.range.getStartPosition();
			const end = edit.range.getEndPosition();

			if (position.isBeforeOrEqual(start)) {
				break;
			}

			const len = lengthOfText(edit.text);
			if (position.isBefore(end)) {
				const startPos = new Position(start.lineNumber + lineDelta, start.column + (start.lineNumber + lineDelta === curLine ? columnDeltaInCurLine : 0));
				const endPos = addPositions(startPos, len);
				return rangeFromPositions(startPos, endPos);
			}

			lineDelta += len.lineNumber - 1 - (edit.range.endLineNumber - edit.range.startLineNumber);

			if (len.lineNumber === 1) {
				if (end.lineNumber !== start.lineNumber) {
					columnDeltaInCurLine += len.column - 1 - (end.column - 1);
				} else {
					columnDeltaInCurLine += len.column - 1 - (end.column - start.column);
				}
			} else {
				columnDeltaInCurLine = len.column - 1;
			}
			curLine = end.lineNumber + lineDelta;
		}

		return new Position(position.lineNumber + lineDelta, position.column + (position.lineNumber + lineDelta === curLine ? columnDeltaInCurLine : 0));
	}

	mapRange(range: Range): Range {
		function getStart(p: Position | Range) {
			return p instanceof Position ? p : p.getStartPosition();
		}

		function getEnd(p: Position | Range) {
			return p instanceof Position ? p : p.getEndPosition();
		}

		const start = getStart(this.mapPosition(range.getStartPosition()));
		const end = getEnd(this.mapPosition(range.getEndPosition()));

		return rangeFromPositions(start, end);
	}

	// TODO: `doc` is not needed for this!
	reverseMapPosition(positionAfterEdit: Position, doc: SourceDocument): Position | Range {
		const reversed = this.reverse(doc);
		return reversed.mapPosition(positionAfterEdit);
	}

	reverseMapRange(range: Range, doc: SourceDocument): Range {
		const reversed = this.reverse(doc);
		return reversed.mapRange(range);
	}

	applyToLines(document: SourceDocument): string {
		let result = '';
		let lastEditEnd = new Position(1, 1);
		for (const edit of this.edits) {
			const editRange = edit.range;
			const editStart = editRange.getStartPosition();
			const editEnd = editRange.getEndPosition();

			const r = rangeFromPositions(lastEditEnd, editStart);
			if (!r.isEmpty()) {
				result += document.getValue(r);
			}
			result += edit.text;
			lastEditEnd = editEnd;
		}
		const r = rangeFromPositions(lastEditEnd, document.endPositionExclusive);
		if (!r.isEmpty()) {
			result += document.getValue(r);
		}
		return result;
	}

	reverse(doc: SourceDocument): TextEdit {
		const ranges = this.getNewRanges();
		return new TextEdit(this.edits.map((e, idx) => new SingleTextEdit(ranges[idx], doc.getValue(e.range))));
	}

	getNewRanges(): Range[] {
		const newRanges: Range[] = [];
		let previousEditEndLineNumber = 0;
		let lineOffset = 0;
		let columnOffset = 0;
		for (const edit of this.edits) {
			const text = edit.text ?? '';
			const textLength = lengthOfText(text);
			const newRangeStart = Position.lift({
				lineNumber: edit.range.startLineNumber + lineOffset,
				column: edit.range.startColumn + (edit.range.startLineNumber === previousEditEndLineNumber ? columnOffset : 0)
			});
			const newRangeEnd = addPositions(
				newRangeStart,
				textLength
			);
			newRanges.push(Range.fromPositions(newRangeStart, newRangeEnd));
			lineOffset += textLength.lineNumber - edit.range.endLineNumber + edit.range.startLineNumber - 1;
			columnOffset = newRangeEnd.column - edit.range.endColumn;
			previousEditEndLineNumber = edit.range.endLineNumber;
		}
		return newRanges;
	}
}

function rangeFromPositions(start: Position, end: Position): Range {
	if (!start.isBeforeOrEqual(end)) {
		throw new BugIndicatingError('start must be before end');
	}
	return new Range(start.lineNumber, start.column, end.lineNumber, end.column);
}

function lengthOfText(text: string): Position {
	let line = 1;
	let column = 1;
	for (const c of text) {
		if (c === '\n') {
			line++;
			column = 1;
		} else {
			column++;
		}
	}
	return new Position(line, column);
}

function addPositions(pos1: Position, pos2: Position): Position {
	return new Position(pos1.lineNumber + pos2.lineNumber - 1, pos2.lineNumber === 1 ? pos1.column + pos2.column - 1 : pos2.column);
}

export interface SourceDocument {
	getValue(range: Range): string;
	readonly endPositionExclusive: Position;
}

export class VirtualSourceDocument implements SourceDocument {
	constructor(
		private readonly _getLineContent: (lineNumber: number) => string,
		private readonly _lineCount: number,
	) { }

	getValue(range: Range): string {
		if (range.startLineNumber === range.endLineNumber) {
			return this._getLineContent(range.startLineNumber).substring(range.startColumn - 1, range.endColumn - 1);
		}
		let result = this._getLineContent(range.startLineNumber).substring(range.startColumn - 1);
		for (let i = range.startLineNumber + 1; i < range.endLineNumber; i++) {
			result += '\n' + this._getLineContent(i);
		}
		result += '\n' + this._getLineContent(range.endLineNumber).substring(0, range.endColumn - 1);
		return result;
	}

	get endPositionExclusive(): Position {
		const lastLine = this._getLineContent(this._lineCount);
		return new Position(this._lineCount, lastLine.length + 1);
	}
}

export class SingleTextEdit {
	constructor(
		public readonly range: Range,
		public readonly text: string,
	) {
	}
}
