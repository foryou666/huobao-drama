/**
 * Reset an episode to blank draft state for redo.
 * Usage: node scripts/reset-episode.mjs <drama_id> <episode_number>
 */
import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const dramaId = Number(process.argv[2] || 5)
const episodeNumber = Number(process.argv[3] || 9)

const dbPath = join(dirname(fileURLToPath(import.meta.url)), '../../data/huobao_drama.db')
const db = new Database(dbPath)

const ep = db.prepare(
  'SELECT id, title FROM episodes WHERE drama_id = ? AND episode_number = ? AND deleted_at IS NULL',
).get(dramaId, episodeNumber)

if (!ep) {
  console.error(`Episode not found: drama=${dramaId} ep=${episodeNumber}`)
  process.exit(1)
}

const episodeId = ep.id
const ts = new Date().toISOString()

function inClause(ids) {
  return ids.length ? ids.map(() => '?').join(',') : null
}

function count(sql, ...params) {
  return db.prepare(sql).get(...params)?.c ?? 0
}

const sbIds = db.prepare('SELECT id FROM storyboards WHERE episode_id = ?').all(episodeId).map(r => r.id)
const spIds = db.prepare('SELECT id FROM shot_plans WHERE episode_id = ?').all(episodeId).map(r => r.id)
const threadIds = db.prepare('SELECT id FROM assistant_threads WHERE episode_id = ?').all(episodeId).map(r => r.id)

const before = {
  storyboards: count('SELECT COUNT(*) c FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL', episodeId),
  shot_plans: count('SELECT COUNT(*) c FROM shot_plans WHERE episode_id = ? AND deleted_at IS NULL', episodeId),
  episode_characters: count('SELECT COUNT(*) c FROM episode_characters WHERE episode_id = ?', episodeId),
  episode_scenes: count('SELECT COUNT(*) c FROM episode_scenes WHERE episode_id = ?', episodeId),
  assistant_threads: threadIds.length,
  script_chars: count('SELECT length(script_content) c FROM episodes WHERE id = ?', episodeId),
}

const reset = db.transaction(() => {
  const sbIn = inClause(sbIds)
  if (sbIn) {
    db.prepare(`DELETE FROM storyboard_characters WHERE storyboard_id IN (${sbIn})`).run(...sbIds)
    db.prepare(`DELETE FROM shot_clip_plans WHERE storyboard_id IN (${sbIn})`).run(...sbIds)
    db.prepare(`DELETE FROM video_prompt_history WHERE storyboard_id IN (${sbIn})`).run(...sbIds)
    db.prepare(`DELETE FROM image_generations WHERE storyboard_id IN (${sbIn})`).run(...sbIds)
    db.prepare(`UPDATE video_generations SET deleted_at = ?, updated_at = ? WHERE storyboard_id IN (${sbIn}) AND deleted_at IS NULL`)
      .run(ts, ts, ...sbIds)
    db.prepare(`UPDATE assets SET deleted_at = ?, updated_at = ? WHERE storyboard_id IN (${sbIn}) AND deleted_at IS NULL`)
      .run(ts, ts, ...sbIds)
    db.prepare('DELETE FROM storyboards WHERE episode_id = ?').run(episodeId)
  }

  const spIn = inClause(spIds)
  if (spIn) {
    db.prepare(`DELETE FROM shot_plan_characters WHERE shot_plan_id IN (${spIn})`).run(...spIds)
    db.prepare(`DELETE FROM shot_clip_plans WHERE shot_plan_id IN (${spIn})`).run(...spIds)
    db.prepare('DELETE FROM shot_plans WHERE episode_id = ?').run(episodeId)
  }

  db.prepare('DELETE FROM episode_characters WHERE episode_id = ?').run(episodeId)
  db.prepare('DELETE FROM episode_scenes WHERE episode_id = ?').run(episodeId)

  const thIn = inClause(threadIds)
  if (thIn) {
    db.prepare(`DELETE FROM assistant_messages WHERE thread_id IN (${thIn})`).run(...threadIds)
    db.prepare('DELETE FROM assistant_threads WHERE episode_id = ?').run(episodeId)
  }

  db.prepare('UPDATE video_merges SET deleted_at = ? WHERE episode_id = ? AND deleted_at IS NULL').run(ts, episodeId)
  db.prepare('UPDATE assets SET deleted_at = ?, updated_at = ? WHERE episode_id = ? AND deleted_at IS NULL').run(ts, ts, episodeId)

  db.prepare(`
    UPDATE episodes SET
      content = NULL,
      script_content = NULL,
      description = NULL,
      video_url = NULL,
      thumbnail = NULL,
      duration = 0,
      status = 'draft',
      updated_at = ?
    WHERE id = ?
  `).run(ts, episodeId)

  // Test-only mistaken character「韩庄」(only linked to this episode)
  const hanzhuang = db.prepare(
    "SELECT c.id FROM characters c WHERE c.drama_id = ? AND c.name = '韩庄' AND c.deleted_at IS NULL",
  ).get(dramaId)
  if (hanzhuang) {
    const onlyEp = db.prepare(
      'SELECT COUNT(*) c FROM episode_characters WHERE character_id = ?',
    ).get(hanzhuang.id).c
    if (onlyEp === 0) {
      db.prepare('UPDATE characters SET deleted_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, hanzhuang.id)
      db.prepare(`
        UPDATE assets SET deleted_at = ?, updated_at = ?
        WHERE source_type = 'character' AND source_id = ? AND deleted_at IS NULL
      `).run(ts, ts, hanzhuang.id)
    }
  }
})

reset()

const after = {
  storyboards: count('SELECT COUNT(*) c FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL', episodeId),
  shot_plans: count('SELECT COUNT(*) c FROM shot_plans WHERE episode_id = ? AND deleted_at IS NULL', episodeId),
  episode_characters: count('SELECT COUNT(*) c FROM episode_characters WHERE episode_id = ?', episodeId),
  episode_scenes: count('SELECT COUNT(*) c FROM episode_scenes WHERE episode_id = ?', episodeId),
  assistant_threads: count('SELECT COUNT(*) c FROM assistant_threads WHERE episode_id = ?', episodeId),
  script_chars: count('SELECT COALESCE(length(script_content), 0) c FROM episodes WHERE id = ?', episodeId),
  hanzhuang: count("SELECT COUNT(*) c FROM characters WHERE drama_id = ? AND name = '韩庄' AND deleted_at IS NULL", dramaId),
}

console.log(`Reset episode ${episodeNumber} (${ep.title}, id=${episodeId}) of drama ${dramaId}`)
console.log('Before:', before)
console.log('After:', after)
console.log('Done — episode is ready for a fresh workflow.')

db.close()
