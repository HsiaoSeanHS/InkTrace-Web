(function (root) {
  'use strict';

  const SVG_FORMAT = 'filled-outline-v2';
  const CANVAS_SIZE = 400;
  const SVG_SIZE = 300;
  const SIMPLIFY_DISTANCE = 2;
  const SMOOTH_RADIUS = 2;
  const CAP_SEGMENTS = 8;

  function title(value) {
    const s = String(value || '').trim();
    if (!s || s.length > 80 || /[\/\\%?#\x00-\x1f\x7f-\x9f]/.test(s) || s.includes('..')) {
      throw Error('名稱限 1–80 字，不能包含 / \\ % ? # 或 ..。');
    }
    return s;
  }

  function characters(text) {
    const chars = [...text.replace(/^\uFEFF/, '')].filter(c => !/[\s\uFEFF]/u.test(c));
    if (!chars.length || chars.length > 4096) {
      throw Error('每份稿紙限 1–4096 字。');
    }
    if (chars.some(c => /[\x00-\x1f\x7f-\x9f\uD800-\uDFFF]/u.test(c))) {
      throw Error('內容含有不支援的控制字元。');
    }
    return chars;
  }

  function paper(name, text, { id = crypto.randomUUID(), createdAt = Date.now() } = {}) {
    return {
      id,
      title: title(name),
      chars: characters(text),
      drafts: {},
      selected: 0,
      createdAt,
    };
  }

  function name(char, occurrence = 1) {
    const stem = /[\/\\%?#.]/.test(char) ? 'U+' + char.codePointAt(0).toString(16).toUpperCase() : char;
    const suffix = occurrence > 1 ? `-${occurrence}` : '';
    return `${stem}${suffix}.svg`;
  }

  const paperFiles = new WeakMap();

  function filesFor(chars) {
    let files = paperFiles.get(chars);
    if (!files) {
      const counts = new Map();
      const names = chars.map(char => {
        const occurrence = (counts.get(char) || 0) + 1;
        counts.set(char, occurrence);
        return name(char, occurrence);
      });
      files = { names, counts };
      paperFiles.set(chars, files);
    }
    return files;
  }

  function filenameAt(paper, index) {
    return filesFor(paper.chars).names[index];
  }

  function signature(strokes) {
    return JSON.stringify(strokes || []);
  }
  const boardFields = {
    regular: { strokes: 'strokes', upload: 'uploaded' },
    rough: { strokes: 'roughStrokes', upload: 'roughUploaded' },
  };

  function strokeCount(strokes = []) {
    return strokes.reduce((count, stroke) => count + Number(stroke.length > 0), 0);
  }

  function hasMatchingStrokeCounts(draft) {
    const regularCount = strokeCount(draft?.strokes);
    return regularCount > 0 && regularCount === strokeCount(draft?.roughStrokes);
  }

  function done(p, index, destination, side = 'regular') {
    const draft = p.drafts[index];
    const fields = boardFields[side];
    const upload = draft?.[fields.upload];
    if (!upload || upload.svgFormat !== SVG_FORMAT ||
      upload.title !== p.title || upload.destination !== destination) {
      return false;
    }
    const released = Number.isInteger(draft.releasedStrokeCount) && draft.releasedStrokeCount > 0;
    if (!released && (upload.signature !== signature(draft[fields.strokes]) ||
      (side === 'rough' && !hasMatchingStrokeCounts(draft)))) {
      return false;
    }
    const files = filesFor(p.chars);
    // Legacy records for repeated characters may refer to the same overwritten file.
    return upload.filename === undefined
      ? files.counts.get(p.chars[index]) === 1
      : upload.filename === files.names[index];
  }

  function pairDone(p, index, destination) {
    return done(p, index, destination) && done(p, index, destination, 'rough');
  }

  function count(p, dest) {
    return p.chars.reduce((n, _, i) => n + Number(pairDone(p, i, dest)), 0);
  }

  function releaseUploadedDraft(paper, index, destination) {
    const draft = paper.drafts[index];
    if (!draft || draft.releasedStrokeCount || !pairDone(paper, index, destination)) {
      return null;
    }

    const { signature: regularSignature, ...uploaded } = draft.uploaded;
    const { signature: roughSignature, ...roughUploaded } = draft.roughUploaded;
    return {
      releasedStrokeCount: strokeCount(draft.strokes),
      uploaded,
      roughUploaded,
    };
  }

  function insideCanvas(point) {
    return point.x >= 0 && point.x <= CANVAS_SIZE && point.y >= 0 && point.y <= CANVAS_SIZE;
  }

  function interpolatePoint(start, end, fraction) {
    return {
      x: start.x + (end.x - start.x) * fraction,
      y: start.y + (end.y - start.y) * fraction,
      width: start.width + (end.width - start.width) * fraction,
    };
  }

  function clipSegment(start, end) {
    let enter = 0;
    let exit = 1;
    for (const axis of ['x', 'y']) {
      const delta = end[axis] - start[axis];
      if (delta === 0) {
        if (start[axis] < 0 || start[axis] > CANVAS_SIZE) {
          return null;
        }
        continue;
      }
      const first = -start[axis] / delta;
      const last = (CANVAS_SIZE - start[axis]) / delta;
      enter = Math.max(enter, Math.min(first, last));
      exit = Math.min(exit, Math.max(first, last));
      if (enter > exit) {
        return null;
      }
    }
    return [enter, exit].map(fraction => {
      const point = interpolatePoint(start, end, fraction);
      // Clamp rounding error at the calculated intersection.
      point.x = Math.min(CANVAS_SIZE, Math.max(0, point.x));
      point.y = Math.min(CANVAS_SIZE, Math.max(0, point.y));
      return point;
    });
  }

  function prepareStroke(stroke) {
    const samples = [stroke[0]];
    for (let index = 1; index < stroke.length; index++) {
      const point = stroke[index];
      const last = samples.at(-1);
      const distance = Math.hypot(point.x - last.x, point.y - last.y);
      if (distance === 0) {
        // A stationary sample can still change the pressure of a dot.
        samples[samples.length - 1] = point;
      } else if (distance >= SIMPLIFY_DISTANCE || index === stroke.length - 1) {
        samples.push(point);
      }
    }

    // Keep the original endpoints. A short mark needs both to remain visible.
    return samples.map((point, index) => {
      const radius = Math.min(SMOOTH_RADIUS, index, samples.length - 1 - index);
      if (radius === 0) {
        return point;
      }
      const sum = { x: 0, y: 0, width: 0 };
      for (let neighbor = index - radius; neighbor <= index + radius; neighbor++) {
        sum.x += samples[neighbor].x;
        sum.y += samples[neighbor].y;
        sum.width += samples[neighbor].width;
      }
      const count = radius * 2 + 1;
      return { x: sum.x / count, y: sum.y / count, width: sum.width / count };
    });
  }

  function offsetPoint(point, angle) {
    const radius = point.width / 2;
    return { x: point.x + Math.cos(angle) * radius, y: point.y + Math.sin(angle) * radius };
  }

  function roundCap(point, startAngle) {
    return Array.from({ length: CAP_SEGMENTS - 1 }, (_, index) =>
      offsetPoint(point, startAngle - Math.PI * (index + 1) / CAP_SEGMENTS)
    );
  }

  function buildContour(points) {
    if (points.length === 1) {
      const segments = CAP_SEGMENTS * 2;
      return Array.from({ length: segments }, (_, index) =>
        offsetPoint(points[0], -2 * Math.PI * index / segments)
      );
    }

    const left = [];
    const right = [];
    const angles = [];
    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      const previous = points[Math.max(0, index - 1)];
      const next = points[Math.min(index + 1, points.length - 1)];
      const dx = next.x - previous.x;
      const dy = next.y - previous.y;
      const normal = Math.atan2(dy, dx) + Math.PI / 2;
      angles.push(normal);
      left.push(offsetPoint(point, normal));
      right.push(offsetPoint(point, normal + Math.PI));
    }

    return [
      ...left,
      ...roundCap(points.at(-1), angles.at(-1)),
      ...right.reverse(),
      ...roundCap(points[0], angles[0] + Math.PI),
    ];
  }

  function strokeContours(stroke) {
    const samples = [];
    for (const point of prepareStroke(stroke)) {
      const last = samples.at(-1);
      if (last && point.x === last.x && point.y === last.y) {
        if (point.width > last.width) {
          samples[samples.length - 1] = point;
        }
      } else {
        samples.push(point);
      }
    }

    const contours = [];
    let start = 0;
    for (let index = 1; index < samples.length - 1; index++) {
      const previous = samples[index - 1];
      const point = samples[index];
      const next = samples[index + 1];
      const incomingX = point.x - previous.x;
      const incomingY = point.y - previous.y;
      const outgoingX = next.x - point.x;
      const outgoingY = next.y - point.y;
      const lengths = Math.hypot(incomingX, incomingY) * Math.hypot(outgoingX, outgoingY);
      const cosine = (incomingX * outgoingX + incomingY * outgoingY) / lengths;
      if (cosine < -0.95) {
        // Close a contour at a hairpin so the left and right sides do not cancel.
        contours.push(buildContour(samples.slice(start, index + 1)));
        start = index;
      }
    }
    contours.push(buildContour(samples.slice(start)));
    return contours;
  }

  function contoursForStroke(stroke) {
    const contours = [];
    let start = 0;
    for (let index = 1; index < stroke.length; index++) {
      if (stroke[index].move) {
        contours.push(...strokeContours(stroke.slice(start, index)));
        start = index;
      }
    }
    contours.push(...strokeContours(stroke.slice(start)));
    return contours;
  }

  function clipContour(contour) {
    if (contour.every(insideCanvas)) {
      return contour;
    }
    for (const [axis, limit, sign] of [
      ['x', 0, 1], ['x', CANVAS_SIZE, -1], ['y', 0, 1], ['y', CANVAS_SIZE, -1],
    ]) {
      if (!contour.length) {
        break;
      }
      const clipped = [];
      let previous = contour.at(-1);
      let previousInside = (previous[axis] - limit) * sign >= 0;
      for (const point of contour) {
        const inside = (point[axis] - limit) * sign >= 0;
        if (inside !== previousInside) {
          const t = (limit - previous[axis]) / (point[axis] - previous[axis]);
          const otherAxis = axis === 'x' ? 'y' : 'x';
          clipped.push({ [axis]: limit, [otherAxis]: previous[otherAxis] +
            (point[otherAxis] - previous[otherAxis]) * t });
        }
        if (inside) {
          clipped.push(point);
        }
        previous = point;
        previousInside = inside;
      }
      contour = clipped;
    }
    return contour;
  }

  function svg(strokes, { clipToFrame = true, framePadding = 0 } = {}) {
    const outlines = strokes.filter(stroke => stroke.length).map(stroke =>
      contoursForStroke(stroke).map(contour => clipToFrame ? clipContour(contour) : contour)
        .filter(contour => contour.length >= 3)
    ).filter(contours => contours.length);
    if (!outlines.length) {
      throw Error('請先寫字。');
    }

    const scale = SVG_SIZE / CANVAS_SIZE;
    const format = value => Number(value.toFixed(5));
    // Preserve the common coordinate frame for pairing, including paths outside it.
    const overflow = clipToFrame ? '' : ' overflow="visible"';
    const padding = framePadding * SVG_SIZE;
    const size = SVG_SIZE + 2 * padding;
    const elements = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-padding} ${-padding} ${size} ${size}" width="${size}" height="${size}"${overflow}>`,
    ];
    for (const contours of outlines) {
      const path = contours.map(contour => {
        const commands = contour.map((point, index) => {
          const x = format(point.x * scale);
          const y = format(point.y * scale);
          return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
        });
        return `${commands.join(' ')} Z`;
      }).join(' ');
      elements.push(`<path d="${path}" fill="black" fill-rule="nonzero"/>`);
    }
    elements.push('</svg>');
    return elements.join('\n');
  }

  function width(base, pressure, sensitivity) {
    const clampedSensitivity = Math.max(0, Math.min(1, sensitivity));
    const clampedPressure = Math.max(0.15, Math.min(1, pressure));
    return base * (1 - clampedSensitivity * (1 - clampedPressure));
  }

  function parseJSON(raw) {
    const p = JSON.parse(raw);
    if (
      !p || typeof p !== 'object' || Array.isArray(p) ||
      typeof p.title !== 'string' || typeof p.text !== 'string' || p.textUrl !== undefined
    ) {
      throw Error('請提供含 title、text 的稿紙 JSON。');
    }
    title(p.title);
    characters(p.text);
    return p;
  }

  const api = {
    svgFormat: SVG_FORMAT,
    canvasSize: CANVAS_SIZE,
    title,
    characters,
    paper,
    name,
    filenameAt,
    signature,
    done,
    pairDone,
    count,
    releaseUploadedDraft,
    strokeCount,
    hasMatchingStrokeCounts,
    boardFields,
    insideCanvas,
    clipSegment,
    svg,
    width,
    parseJSON,
  };
  root.InkTrace = api;
  if (typeof module !== 'undefined') {
    module.exports = api;
  }
})(globalThis);
