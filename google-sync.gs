var SYNC_SECRET = "CHANGE_ME_SYNC_SECRET";
var TAB_NAMES = {
  devices: "Devices",
  history: "History",
  tasks: "Tasks",
  users: "Users",
  settings: "Settings",
  meta: "Meta",
};

function jsonOut(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function isAuthorized(e) {
  var provided = (e.parameter && e.parameter.auth) || "";
  return !!provided && provided === SYNC_SECRET;
}

function safeParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return fallback;
  }
}

function ensureSheet(book, name, headers) {
  var sh = book.getSheetByName(name) || book.insertSheet(name);
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sh;
}

function getSheet(book, name, headers) {
  var sh = book.getSheetByName(name) || book.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sh;
}

function deriveRowId(prefix, row, index) {
  if (row && row.id) {
    return String(row.id);
  }
  var base = [
    prefix,
    index,
    row && (row.date || row.username || row.serial || row.staff),
    row && (row.action || row.title || row.name || row.tag),
  ].filter(Boolean).join("_");
  return base || prefix + "_" + index;
}

function writeCollection(book, name, prefix, rows) {
  var sh = ensureSheet(book, name, ["id", "sortOrder", "updatedAt", "json"]);
  if (!rows.length) {
    return sh;
  }
  var values = rows.map(function(row, index) {
    return [
      deriveRowId(prefix, row, index),
      index,
      (row && (row.updatedAt || row.lastLogin || row.date)) || "",
      JSON.stringify(row || {}),
    ];
  });
  sh.getRange(2, 1, values.length, 4).setValues(values);
  return sh;
}

function readCollection(book, name) {
  var sh = getSheet(book, name, ["id", "sortOrder", "updatedAt", "json"]);
  if (sh.getLastRow() < 2) {
    return [];
  }
  return sh
    .getRange(2, 1, sh.getLastRow() - 1, 4)
    .getValues()
    .filter(function(row) {
      return row[0] || row[3];
    })
    .sort(function(a, b) {
      return Number(a[1] || 0) - Number(b[1] || 0);
    })
    .map(function(row) {
      return safeParse(row[3], {});
    });
}

function writeSettings(book, settings) {
  var sh = ensureSheet(book, TAB_NAMES.settings, ["key", "value"]);
  var keys = Object.keys(settings || {}).sort();
  if (!keys.length) {
    return sh;
  }
  var values = keys.map(function(key) {
    return [key, JSON.stringify(settings[key])];
  });
  sh.getRange(2, 1, values.length, 2).setValues(values);
  return sh;
}

function readSettings(book) {
  var sh = getSheet(book, TAB_NAMES.settings, ["key", "value"]);
  if (sh.getLastRow() < 2) {
    return {};
  }
  return sh
    .getRange(2, 1, sh.getLastRow() - 1, 2)
    .getValues()
    .filter(function(row) {
      return row[0];
    })
    .reduce(function(acc, row) {
      acc[row[0]] = safeParse(row[1], row[1]);
      return acc;
    }, {});
}

function writeMeta(book, lastSync) {
  var sh = ensureSheet(book, TAB_NAMES.meta, ["key", "value"]);
  sh.getRange(2, 1, 2, 2).setValues([
    ["last_sync", lastSync],
    ["layout", "split-tabs-v1"],
  ]);
  return sh;
}

function readMeta(book) {
  var sh = getSheet(book, TAB_NAMES.meta, ["key", "value"]);
  if (sh.getLastRow() < 2) {
    return {};
  }
  return sh
    .getRange(2, 1, sh.getLastRow() - 1, 2)
    .getValues()
    .filter(function(row) {
      return row[0];
    })
    .reduce(function(acc, row) {
      acc[row[0]] = row[1];
      return acc;
    }, {});
}

function readLegacySnapshot(book) {
  var legacy = book.getSheetByName("ITData");
  if (!legacy) {
    return null;
  }
  var cell = legacy.getRange("A1").getValue();
  return cell ? safeParse(cell, null) : null;
}

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  try {
    if (!isAuthorized(e)) {
      return jsonOut({ error: "Unauthorized" });
    }

    var book = SpreadsheetApp.getActiveSpreadsheet();
    var action = (e.parameter && e.parameter.action) || "read";
    var meta = readMeta(book);

    if (action === "health") {
      return jsonOut({
        ok: true,
        service: "google-sheets-sync",
        layout: meta.layout || "split-tabs-v1",
        updatedAt: meta.last_sync || "",
      });
    }

    if (action === "read") {
      var payload = {
        devices: readCollection(book, TAB_NAMES.devices),
        history: readCollection(book, TAB_NAMES.history),
        tasks: readCollection(book, TAB_NAMES.tasks),
        users: readCollection(book, TAB_NAMES.users),
        settings: readSettings(book),
      };
      if (!payload.devices.length && !payload.history.length && !payload.tasks.length && !payload.users.length && !Object.keys(payload.settings).length) {
        var legacy = readLegacySnapshot(book);
        if (legacy) {
          return jsonOut(legacy);
        }
      }
      return jsonOut(payload);
    }

    if (action === "write") {
      var incoming = JSON.parse((e.parameter && e.parameter.data) || "{}");
      var now = new Date().toISOString();
      writeCollection(book, TAB_NAMES.devices, "device", Array.isArray(incoming.devices) ? incoming.devices : []);
      writeCollection(book, TAB_NAMES.history, "history", Array.isArray(incoming.history) ? incoming.history : []);
      writeCollection(book, TAB_NAMES.tasks, "task", Array.isArray(incoming.tasks) ? incoming.tasks : []);
      writeCollection(book, TAB_NAMES.users, "user", Array.isArray(incoming.users) ? incoming.users : []);
      writeSettings(book, incoming.settings || {});
      writeMeta(book, now);
      return jsonOut({ ok: true, layout: "split-tabs-v1", updatedAt: now });
    }

    return jsonOut({ error: "Unknown action" });
  } catch (err) {
    return jsonOut({ error: err && err.message ? err.message : String(err) });
  }
}
