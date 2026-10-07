(function (global) {
  function emptyState() {
    return { insertedBreaks: [], removedLineBreaks: [] };
  }

  // Offsets use UTF-16 positions in each original line's replacement result.
  // Keep segment metadata (especially match identity) through every split/join.
  function buildLines(sourceLines, edits) {
    const rows = [{ segments: [], text: "" }];
    const removed = new Set(edits.removedLineBreaks);
    function boundary(value) {
      rows[rows.length - 1].boundaryAfter = value;
      rows.push({ segments: [], text: "" });
    }
    sourceLines.forEach((line, index) => {
      const text = line.segments.map((segment) => segment.text).join("");
      const offsets = [...new Set(edits.insertedBreaks
        .filter((item) => item.lineId === line.id && item.offset >= 0 && item.offset <= text.length)
        .map((item) => item.offset))].sort((a, b) => a - b);
      let start = 0;
      for (const [partIndex, end] of [...offsets, text.length].entries()) {
        let cursor = 0;
        for (const segment of line.segments) {
          const from = Math.max(start, cursor);
          const to = Math.min(end, cursor + segment.text.length);
          if (from < to) {
            const part = { ...segment, text: segment.text.slice(from - cursor, to - cursor),
              lineId: line.id, offset: from };
            rows[rows.length - 1].segments.push(part);
            rows[rows.length - 1].text += part.text;
          }
          cursor += segment.text.length;
        }
        if (partIndex < offsets.length) {
          boundary({ type: "inserted", lineId: line.id, offset: end });
        }
        start = end;
      }
      if (index < sourceLines.length - 1 && !removed.has(line.id)) {
        boundary({ type: "original", lineId: line.id });
      }
    });
    return rows.map((row, index) => ({ ...row, lineNumber: index + 1 }));
  }

  function insertBreak(edits, position) {
    if (!edits.insertedBreaks.some((item) => item.lineId === position.lineId && item.offset === position.offset)) {
      edits.insertedBreaks.push({ ...position });
    }
  }

  function removeBreak(edits, boundary) {
    if (boundary.type === "inserted") {
      edits.insertedBreaks = edits.insertedBreaks.filter((item) =>
        item.lineId !== boundary.lineId || item.offset !== boundary.offset);
    } else if (!edits.removedLineBreaks.includes(boundary.lineId)) {
      edits.removedLineBreaks.push(boundary.lineId);
    }
  }

  function forSource(previousSource, nextSource, edits) {
    return previousSource === nextSource ? edits : emptyState();
  }

  const api = { emptyState, buildLines, insertBreak, removeBreak, forSource };
  global.LineBreaks = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
