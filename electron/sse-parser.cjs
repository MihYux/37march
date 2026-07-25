function createSseJsonParser(onPayload, { onDone = () => {} } = {}) {
  let buffer = "";
  let dataLines = [];

  const emitEvent = () => {
    if (!dataLines.length) return;
    const rawPayload = dataLines.join("\n").trim();
    dataLines = [];
    if (!rawPayload) return;
    if (rawPayload === "[DONE]") {
      onDone();
      return;
    }
    onPayload(JSON.parse(rawPayload));
  };

  const processLine = (rawLine) => {
    const line = rawLine.replace(/\r$/, "");
    if (!line) {
      emitEvent();
      return;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
      return;
    }

    const trimmed = line.trim();
    if (trimmed.startsWith("{")) {
      emitEvent();
      onPayload(JSON.parse(trimmed));
    }
  };

  return {
    push(text) {
      buffer += text;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        processLine(buffer.slice(0, newlineIndex));
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");
      }
    },
    finish() {
      if (buffer) processLine(buffer);
      buffer = "";
      emitEvent();
    },
  };
}

module.exports = { createSseJsonParser };
