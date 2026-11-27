/**
 * Caplet helper
 *
 *   createCaplet("NS22")                     single station caplet
 *   createCaplet("TE22A")                    code with a suffix letter
 *   createCaplet("NS")  /  createCaplet("NSL")   line-only caplet
 *   createCaplet("NS25/EW13")                interchange (caplets joined in one outline)
 *   createCaplet(["CC1", "NE6", "NS24"])     interchange, array form
 *   createCaplet("DT11/NS21", { transfer: true })   tap-out-to-transfer (separate caplets + connector)
 *   createTransferCaplet("DT11", "NS21")     shorthand for the above
 *
 * Options (all optional):
 *   fill       colour for the coloured shape(s). A string applies to every segment;
 *              an array sets them per segment, e.g. ["#123456", null] (null = line default)
 *   outline    colour of the "outline" (the larger shape behind). Default white.
 *   textColor  string or array, same rules as fill. If omitted: a custom hex fill picks
 *              dark/light text automatically, otherwise the line's default is used.
 *   transfer   true = tap-out-to-transfer layout instead of an interchange
 *
 * Any CSS colour works, including variables, e.g. { fill: "var(--brand-500)" }.
 *
 * In HTML:
 *   <span data-caplet="NS25/EW13"></span>
 *   <span data-caplet="DT11/NS21" data-caplet-transfer></span>
 *   <span data-caplet="NS22" data-caplet-fill="#123456" data-caplet-outline="#ffd100"></span>
 *   Arrays in data attributes use "|" as separator: data-caplet-fill="#123456|#abcdef"
 *
 * Line colours come from the CSS variables in global.css (--nsl, --ewl, ...).
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/* ---------- Geometry (units from the Inkscape exports) ---------- */

const SEG_W = 182;          // coloured segment width
const SEG_H = 103;          // coloured segment height
const OUTLINE_PAD_X = 6;    // outline sticks out this much left/right of the coloured shape
const OUTLINE_PAD_Y = 7;    // ...and this much above (6 below, see OUTER_H)
const OUTER_W = SEG_W + OUTLINE_PAD_X * 2;   // 194: outline width of a single caplet
const OUTER_H = 116;        // outline height
const SEAM = 0.5;           // overlap between joined segments to avoid hairline gaps

// Tap-out-to-transfer layout (from caplet2a.svg)
const TRANSFER_GAP = 48;                          // gap between the two outlines
const CONNECTOR_OVERLAP = 16;                     // connector reaches this far into each outline
const CONNECTOR_W = TRANSFER_GAP + CONNECTOR_OVERLAP * 2;   // 80
const CONNECTOR_H = 34;
const CONNECTOR_Y = (OUTER_H - CONNECTOR_H) / 2;  // 41
const CONNECTOR_SLANT = 7;                        // diagonal split leans +/- this much from centre

// Text
const TEXT_BASELINE_Y = 78;
const TEXT_SIZE = 58;

/* ---------- Colours ---------- */

const DARK_TEXT = "var(--black)";
const LIGHT_TEXT = "var(--grey-0)";
const DEFAULT_OUTLINE = "var(--grey-0)";

// Station-code prefix -> line colour variable (+ optional text colour)
const LINES = {
  NS: { fill: "var(--nsl)" },
  EW: { fill: "var(--ewl)" },
  CG: { fill: "var(--ewl)" }, // Changi Airport branch
  NE: { fill: "var(--nel)" },
  CC: { fill: "var(--ccl)", text: DARK_TEXT },
  CE: { fill: "var(--ccl)", text: DARK_TEXT }, // Circle Line extension
  DT: { fill: "var(--dtl)" },
  TE: { fill: "var(--tel)" },
  JS: { fill: "var(--jrl)" },
  JE: { fill: "var(--jrl)" },
  JW: { fill: "var(--jrl)" },
  CR: { fill: "var(--crl)", text: DARK_TEXT },
  CP: { fill: "var(--crl)", text: DARK_TEXT },
  // LRT
  BP: { fill: "var(--lrt)" },
  SW: { fill: "var(--lrt)" },
  SE: { fill: "var(--lrt)" },
  PW: { fill: "var(--lrt)" },
  PE: { fill: "var(--lrt)" },
};

// Full line names -> a prefix in LINES ("NSL" behaves like "NS", but keeps its label)
const LINE_ALIASES = {
  NSL: "NS",
  EWL: "EW",
  NEL: "NE",
  CCL: "CC",
  DTL: "DT",
  TEL: "TE",
  JRL: "JS",
  CRL: "CR",
  BPL: "BP",
  SKL: "SW",
  PGL: "PW",
};

const FALLBACK = { fill: "var(--grey-500)" };

/* ---------- Parsing ---------- */

/**
 * "NS22" / "ns 22"  -> { style, label: "NS 22" }
 * "TE22A" / "JS2A"  -> { style, label: "TE 22A" / "JS 2A" }   (single-letter suffix)
 * "NS" / "NSL"      -> { style, label: "NS" / "NSL" }
 */
function parseToken(raw) {
  const text = String(raw).trim();
  const match = /^([A-Za-z]{2,3})\s*(?:(\d{1,2})([A-Za-z])?)?$/.exec(text);
  if (!match) return { style: null, label: text.toUpperCase() };

  const letters = match[1].toUpperCase();
  if (match[2] === undefined) {
    return { style: LINES[LINE_ALIASES[letters] || letters] || null, label: letters };
  }
  const suffix = (match[3] || "").toUpperCase();
  return { style: LINES[letters] || null, label: `${letters} ${Number(match[2])}${suffix}` };
}

/** "NS25/EW13", "NS25 EW13", "NS 25, EW 13", "TE22A/NS1" or an array -> array of raw codes */
function splitCodes(input) {
  if (Array.isArray(input)) return input.map(String);
  const text = String(input);
  // A suffix letter only counts if it is not the start of the next code ("NS25EW13")
  return text.match(/[A-Za-z]{2,3}\s*(?:\d{1,2}(?:[A-Za-z](?![A-Za-z]))?)?/g) || [text];
}

/** Option given as a string applies to all segments; an array is per segment. */
function pick(option, index) {
  return Array.isArray(option) ? option[index] : option;
}

/** Pick dark or light text for a #hex colour, whichever has better contrast. */
function contrastText(color) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const DARK_LUMINANCE = 0.0236; // #2E2A25
  const againstDark = (luminance + 0.05) / (DARK_LUMINANCE + 0.05);
  const againstWhite = 1.05 / (luminance + 0.05);
  return againstDark > againstWhite ? DARK_TEXT : LIGHT_TEXT;
}

/** Work out label, fill and text colour for every segment. */
function resolveSegments(input, options) {
  return splitCodes(input).map((raw, i) => {
    const { style, label } = parseToken(raw);
    const line = style || FALLBACK;
    const customFill = pick(options.fill, i) || null;
    const customText = pick(options.textColor, i) || null;
    return {
      label,
      fill: customFill || line.fill,
      text:
        customText ||
        (customFill && contrastText(customFill)) ||
        line.text ||
        LIGHT_TEXT,
    };
  });
}

/* ---------- Shapes ---------- */

const num = (n) => +n.toFixed(4);

/** Solid "outline" pill of any width (height is always OUTER_H). */
function outerPath(width) {
  const r = (x) => num(x + (width - OUTER_W)); // shift right-hand points
  return [
    "M 34.6225,0",
    `H ${r(159.378)}`,
    `C ${r(165.382)},0 ${r(170.388)},2.28727 ${r(174.481)},5.44385`,
    `C ${r(179.441)},9.28584 ${r(182.762)},14.5002 ${r(184.491)},17.9767`,
    `C ${r(187.585)},24.1515 ${r(189.997)},30.6471 ${r(191.589)},37.4169`,
    `C ${r(193.136)},44.0028 ${r(194)},50.9102 ${r(194)},58`,
    `C ${r(194)},65.0898 ${r(193.136)},71.9508 ${r(191.589)},78.6294`,
    `C ${r(189.997)},85.3993 ${r(187.585)},91.8948 ${r(184.491)},98.0697`,
    `C ${r(182.762)},101.546 ${r(179.441)},106.715 ${r(174.481)},110.557`,
    `C ${r(170.388)},113.759 ${r(165.382)},116 ${r(159.378)},116`,
    "H 34.6225",
    "C 28.6182,116 23.5677,113.759 19.5187,110.557",
    "C 14.5135,106.715 11.1924,101.546 9.46304,98.0697",
    "C 6.36941,91.8948 4.00288,85.3537 2.36576,78.6294",
    "C 0.818562,71.9971 0,65.0442 0,58",
    "C 0,50.9558 0.818562,44.0492 2.36576,37.4169",
    "C 4.00288,30.6015 6.36941,24.1515 9.46304,17.9767",
    "C 11.1924,14.5002 14.5589,9.28584 19.5187,5.44385",
    "C 23.5677,2.28727 28.6182,0 34.6225,0",
    "Z",
  ].join(" ");
}

/**
 * One coloured segment, origin at its top-left corner.
 * Rounded or flat on either side, so segments can be butted together.
 */
function segmentPath(roundLeft, roundRight, seam = 0) {
  const d = [roundLeft ? "M 28.4002,0" : "M 0,0"];

  if (roundRight) {
    d.push(
      "H 153.554",
      "C 164.969,0 171.453,11.0753 173.187,14.4021",
      "C 179.032,25.9787 182,38.5114 182,51.5462",
      "C 182,64.5802 179.032,76.9767 173.187,88.5532",
      "C 171.453,91.9255 165.015,103 153.554,103"
    );
  } else {
    d.push(`H ${SEG_W + seam}`, `V ${SEG_H}`);
  }

  if (roundLeft) {
    d.push(
      "H 28.4002",
      "C 17.0313,103 10.5474,91.9255 8.81186,88.5532",
      "C 2.96891,77.0221 0,64.6718 0,51.5462",
      "C 0,38.4206 2.96891,25.9787 8.81186,14.4021",
      "C 10.5474,11.0753 16.9851,0 28.4002,0"
    );
  } else {
    d.push("H 0");
  }

  d.push("Z");
  return d.join(" ");
}

/* ---------- SVG helpers ---------- */

function svgEl(name, attrs = {}) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

function shape(tag, attrs, fill) {
  return svgEl(tag, { ...attrs, style: `fill: ${fill}` });
}

function createRoot(width, ariaLabel) {
  return svgEl("svg", {
    class: "caplet-svg",
    viewBox: `0 0 ${num(width)} ${OUTER_H}`,
    role: "img",
    "aria-label": ariaLabel,
  });
}

// Inline styles so they win over the `.caplet-svg text` rule in global.css
function createLabel(cx, label, color) {
  const text = svgEl("text", {
    x: num(cx),
    y: TEXT_BASELINE_Y,
    style: [
      `fill: ${color}`,
      `font-size: ${TEXT_SIZE}px`,
      "text-anchor: middle",
      "dominant-baseline: alphabetic",
    ].join("; "),
  });
  text.textContent = label;
  return text;
}

/* ---------- Builders ---------- */

/** Single caplet, or several joined in one outline (interchange). */
function buildJoined(segments, outline) {
  const n = segments.length;
  const width = n * SEG_W + OUTLINE_PAD_X * 2;
  const svg = createRoot(width, segments.map((s) => s.label).join(" / "));

  svg.appendChild(shape("path", { d: outerPath(width), "fill-rule": "evenodd" }, outline));

  segments.forEach((seg, i) => {
    const x = OUTLINE_PAD_X + i * SEG_W;
    svg.appendChild(
      shape(
        "path",
        {
          d: segmentPath(i === 0, i === n - 1, i === n - 1 ? 0 : SEAM),
          transform: `translate(${x} ${OUTLINE_PAD_Y})`,
          "fill-rule": "evenodd",
        },
        seg.fill
      )
    );
  });

  segments.forEach((seg, i) => {
    svg.appendChild(createLabel(OUTLINE_PAD_X + i * SEG_W + SEG_W / 2, seg.label, seg.text));
  });

  return svg;
}

/** Separate caplets with a two-colour connector between each pair (tap-out-to-transfer). */
function buildTransfer(segments, outline) {
  const n = segments.length;
  const pitch = OUTER_W + TRANSFER_GAP;
  const width = n * OUTER_W + (n - 1) * TRANSFER_GAP;
  const svg = createRoot(width, segments.map((s) => s.label).join(" to "));

  segments.forEach((seg, i) => {
    const x = i * pitch;
    svg.appendChild(shape("path", { d: outerPath(OUTER_W), transform: `translate(${x} 0)`, "fill-rule": "evenodd" }, outline));
    svg.appendChild(
      shape(
        "path",
        {
          d: segmentPath(true, true),
          transform: `translate(${x + OUTLINE_PAD_X} ${OUTLINE_PAD_Y})`,
          "fill-rule": "evenodd",
        },
        seg.fill
      )
    );
  });

  // Connectors: left colour as a full block, right colour on top with a diagonal edge
  const mid = CONNECTOR_W / 2;
  for (let i = 0; i < n - 1; i++) {
    const g = svgEl("g", {
      transform: `translate(${i * pitch + OUTER_W - CONNECTOR_OVERLAP} ${CONNECTOR_Y})`,
    });
    g.appendChild(shape("rect", { x: 0, y: 0, width: CONNECTOR_W, height: CONNECTOR_H }, segments[i].fill));
    g.appendChild(
      shape(
        "polygon",
        {
          points: [
            `${mid + CONNECTOR_SLANT},0`,
            `${CONNECTOR_W},0`,
            `${CONNECTOR_W},${CONNECTOR_H}`,
            `${mid - CONNECTOR_SLANT},${CONNECTOR_H}`,
          ].join(" "),
        },
        segments[i + 1].fill
      )
    );
    svg.appendChild(g);
  }

  segments.forEach((seg, i) => {
    svg.appendChild(createLabel(i * pitch + OUTER_W / 2, seg.label, seg.text));
  });

  return svg;
}

/* ---------- Public API ---------- */

function createCaplet(input, options = {}) {
  const segments = resolveSegments(input, options);
  const outline = options.outline || DEFAULT_OUTLINE;
  return options.transfer && segments.length > 1
    ? buildTransfer(segments, outline)
    : buildJoined(segments, outline);
}

function createTransferCaplet(...args) {
  // createTransferCaplet("DT11", "NS21", options?)  or  createTransferCaplet(["DT11", "NS21"], options?)
  let options = {};
  if (args.length && typeof args[args.length - 1] === "object" && !Array.isArray(args[args.length - 1])) {
    options = args.pop();
  }
  const codes = args.length === 1 ? args[0] : args;
  return createCaplet(codes, { ...options, transfer: true });
}

/** Replace every element carrying data-caplet="…" with a caplet SVG. */
function hydrateCaplets(root = document) {
  const list = (value) =>
    value === undefined ? undefined : value.includes("|")
      ? value.split("|").map((s) => s.trim() || null)
      : value.trim();

  root.querySelectorAll("[data-caplet]").forEach((el) => {
    const { caplet, capletTransfer, capletFill, capletOutline, capletText } = el.dataset;
    const svg = createCaplet(caplet, {
      transfer: capletTransfer !== undefined && capletTransfer !== "false",
      fill: list(capletFill),
      outline: capletOutline,
      textColor: list(capletText),
    });
    el.classList.forEach((cls) => svg.classList.add(cls));
    el.replaceWith(svg);
  });
}

document.addEventListener("DOMContentLoaded", () => hydrateCaplets());

// Expose for other scripts
window.createCaplet = createCaplet;
window.createTransferCaplet = createTransferCaplet;
window.hydrateCaplets = hydrateCaplets;
