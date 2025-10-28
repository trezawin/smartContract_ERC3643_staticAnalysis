/* eslint-disable */
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO = ZERO_ADDRESS.toLowerCase();

function normalizeFieldPath(field, defaultPrefix = "data.") {
  if (!field) return null;
  if (field.startsWith("data.") || field.startsWith("cfg.")) return field;
  return `${defaultPrefix}${field}`;
}

function getValueByPath(root, pathStr) {
  if (!root || !pathStr) return undefined;
  const parts = pathStr.split(".");
  let cur = root;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function evaluatePrimitiveCondition(cond, data, cfg, helpers) {
  if (!cond || typeof cond !== "object") return true;
  const path = cond.field ? normalizeFieldPath(cond.field) : null;
  const operator = cond.operator || (cond.equals !== undefined ? "equals" : null);
  const value = cond.value !== undefined ? cond.value : cond.equals;

  const left = (() => {
    if (!path) return undefined;
    if (path.startsWith("data.")) return getValueByPath(data, path.slice(5));
    if (path.startsWith("cfg.")) return getValueByPath(cfg, path.slice(4));
    return path;
  })();

  if (operator === null) return true;
  const op = operator.toLowerCase();
  const cmpValue = value;

  const comp = (a, b) => {
    if (a == null || b == null) return false;
    if (typeof a === "number" && typeof b === "number") {
      switch (op) {
        case ">": return a > b;
        case ">=": return a >= b;
        case "<": return a < b;
        case "<=": return a <= b;
        case "!=": return a !== b;
        case "==":
        case "equals": return a === b;
        default: return false;
      }
    }
    const leftStr = String(a).toLowerCase();
    const rightStr = String(b).toLowerCase();
    switch (op) {
      case ">": return leftStr > rightStr;
      case ">=": return leftStr >= rightStr;
      case "<": return leftStr < rightStr;
      case "<=": return leftStr <= rightStr;
      case "!=": return leftStr !== rightStr;
      case "==":
      case "equals": return leftStr === rightStr;
      default: return false;
    }
  };

  return comp(left, cmpValue);
}

function evaluateCondition(cond, data, cfg, helpers) {
  if (!cond) return true;
  if (Array.isArray(cond)) {
    return cond.every((item) => evaluateCondition(item, data, cfg, helpers));
  }
  if (cond.all && Array.isArray(cond.all)) {
    return cond.all.every((item) => evaluateCondition(item, data, cfg, helpers));
  }
  if (cond.any && Array.isArray(cond.any)) {
    return cond.any.some((item) => evaluateCondition(item, data, cfg, helpers));
  }
  return evaluatePrimitiveCondition(cond, data, cfg, helpers);
}

function createMetaRecorder(baseMeta, notes, details) {
  const metaBase = baseMeta || {};
  const addNote = (note) => {
    if (!note) return;
    notes.push(note);
  };
  const addDetail = (detail) => {
    if (!detail || typeof detail !== "object") return;
    const enriched = Object.assign({}, detail);
    if (metaBase.role && enriched.role == null) enriched.role = metaBase.role;
    if (metaBase.phase && enriched.phase == null) enriched.phase = metaBase.phase;
    details.push(enriched);
  };
  return { addNote, addDetail };
}

function createRuleEngine({ operations } = {}) {
  const handlers = Object.create(null);

  const registerOperation = (name, fn) => {
    if (!name || typeof fn !== "function") return;
    handlers[String(name).toLowerCase()] = fn;
  };

  if (operations && typeof operations === "object") {
    for (const [name, fn] of Object.entries(operations)) {
      registerOperation(name, fn);
    }
  }

  const engine = {
    registerOperation,
    evaluate(spec, context) {
      if (!spec || typeof spec !== "object") return null;
      const { data, cfg, helpers = {}, meta } = context || {};
      const notes = [];
      const details = [];
      const recorder = createMetaRecorder(meta, notes, details);

      const execNode = (node) => {
        if (!node || typeof node !== "object") return true;
        const opName = String(node.op || "").toLowerCase();

        const compositeMeta = {
          role: node.role || (meta && meta.role) || null,
          phase: node.phase || (meta && meta.phase) || null
        };
        const nodeRecorder = createMetaRecorder(compositeMeta, notes, details);

        if (node.condition && !evaluateCondition(node.condition, data, cfg, helpers)) {
          nodeRecorder.addNote(`Condition not met for op=${opName || "unknown"}`);
          nodeRecorder.addDetail({ op: opName || "unknown", skipped: true, condition: node.condition });
          return true;
        }

        const handler = handlers[opName];
        if (!handler) {
          nodeRecorder.addNote(`Unknown op '${opName}' treated as pass`);
          nodeRecorder.addDetail({ op: opName || "unknown", unknown: true, ok: true });
          return true;
        }

        const result = handler(node, { data, cfg, helpers, meta: compositeMeta }, nodeRecorder);
        if (result && typeof result === "object") {
          if (Array.isArray(result.notes)) {
            result.notes.forEach((n) => nodeRecorder.addNote(n));
          }
          if (Array.isArray(result.details)) {
            result.details.forEach((d) => nodeRecorder.addDetail(d));
          }
          return result.ok !== undefined ? !!result.ok : true;
        }
        return result === undefined ? true : !!result;
      };

      let pass = true;
      if (spec.check) {
        pass = execNode(spec.check);
      } else if (Array.isArray(spec.allOf)) {
        pass = spec.allOf.every(execNode);
      } else if (Array.isArray(spec.anyOf)) {
        pass = spec.anyOf.some(execNode);
      } else {
        return null;
      }

      return { pass, note: notes.join("; "), details };
    }
  };

  return engine;
}

function buildDefaultOperations() {
  const ops = Object.create(null);

  ops.nonzeroaddress = (node, ctx, recorder) => {
    const field = normalizeFieldPath(node.field || "");
    const addr = ctx.helpers.asAddr ? ctx.helpers.asAddr(field, ctx.cfg, ctx.data) : ZERO;
    const ok = addr !== ZERO;
    recorder.addNote(`${field} is ${addr !== ZERO ? "non-zero" : "zero"}`);
    recorder.addDetail({ op: "nonzeroaddress", field, actual: addr, expected: "!= ZERO", ok });
    return ok;
  };

  ops.equalsaddress = (node, ctx, recorder) => {
    const field = normalizeFieldPath(node.field || "");
    const left = ctx.helpers.asAddr ? ctx.helpers.asAddr(field, ctx.cfg, ctx.data) : ZERO;
    const rightSource = node.equals !== undefined ? node.equals : node.value;
    const right = ctx.helpers.asAddr ? ctx.helpers.asAddr(rightSource, ctx.cfg, ctx.data) : ZERO;
    const ok = left === right;
    recorder.addNote(`${field} equals ${rightSource} → (${left} vs ${right})`);
    recorder.addDetail({ op: "equalsaddress", field, left, right, ok });
    return ok;
  };

  ops.lengthgte = (node, ctx, recorder) => {
    const field = normalizeFieldPath(node.field || "");
    const target = getValueByPath(ctx.data, field.slice(5));
    const actualLength = Array.isArray(target) ? target.length : 0;
    const min = typeof node.value === "number" ? node.value : 0;
    const ok = actualLength >= min;
    recorder.addNote(`${field}.length >= ${min} (actual ${actualLength})`);
    recorder.addDetail({ op: "lengthgte", field, min, actual: actualLength, ok });
    return ok;
  };

  ops.oneofaddress = (node, ctx, recorder) => {
    const field = normalizeFieldPath(node.field || "");
    const left = ctx.helpers.asAddr ? ctx.helpers.asAddr(field, ctx.cfg, ctx.data) : ZERO;
    const values = Array.isArray(node.values) ? node.values : [];
    const allowed = values.map((v) => ctx.helpers.asAddr ? ctx.helpers.asAddr(v, ctx.cfg, ctx.data) : ZERO);
    const ok = allowed.includes(left);
    recorder.addNote(`${field} in [${allowed.join(", ")}] actual=${left}`);
    recorder.addDetail({ op: "oneofaddress", field, actual: left, allowed, ok });
    return ok;
  };

  ops.hasabifn = (node, ctx, recorder) => {
    const where = String(node.where || "").toLowerCase();
    const sig = String(node.sig || node.name || "");
    const present = ctx.helpers.hasFn ? ctx.helpers.hasFn(where, sig) : false;
    recorder.addNote(`ABI has ${where}.${sig}: ${present}`);
    recorder.addDetail({ op: "hasabifn", where, sig, present, ok: !!present });
    return !!present;
  };

  ops.hasevent = (node, ctx, recorder) => {
    const where = String(node.where || "").toLowerCase();
    const name = String(node.name || "");
    const present = ctx.helpers.hasEvent ? ctx.helpers.hasEvent(where, name) : false;
    recorder.addNote(`Event on ${where}:${name} present: ${present}`);
    recorder.addDetail({ op: "hasevent", where, name, present, ok: !!present });
    return !!present;
  };

  return ops;
}

const defaultOperationHandlers = buildDefaultOperations();

module.exports = {
  createRuleEngine,
  defaultOperationHandlers,
  evaluateCondition
};
