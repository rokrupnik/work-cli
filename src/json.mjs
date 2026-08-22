// The non-interactive contract. Field names here are the stable ones: the human
// table can be re-laid-out freely, this cannot without breaking a script.
import path from 'node:path'

export function taskToJson(t) {
  return {
    project: t.project,
    id: t.id,
    title: t.title,
    status: t.status,
    owners: t.owners,
    assignee: t.assignee,
    filenameOwners: t.fileOwners,
    requestedBy: t.requestedBy || null,
    week: t.week || null,
    folder: t.folder,
    folderWeek: t.folderWeek,
    weekClosed: t.folderClosed,
    created: t.created || null,
    completed: t.completed || null,
    blockedBy: t.blockedBy,
    blocks: t.blocks,
    done: t.done,
    slipped: t.slipped,
    unowned: t.unowned,
    leased: t.leased,
    lease: Object.keys(t.lease).length ? t.lease : null,
    path: t.relPath.split(path.sep).join('/'),
    file: t.file,
  }
}

export function diagnosticToJson(d) {
  return {
    severity: d.severity,
    code: d.code,
    project: d.project ?? null,
    task: d.id ?? null,
    file: d.file ?? null,
    line: d.line ?? null,
    message: d.message,
    hint: d.hint ?? null,
  }
}
