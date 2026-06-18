import 'dotenv/config'
import { normalizeAistarslabReferenceUrls, normalizeAistarslabContentRefs } from '../dist/utils/aistarslab-content.js'

const raw = '["static/characters/06ea00fc-20c7-4364-880e-c0e161f4d4c4.png","static/characters/5d227587-7c38-4de4-9888-4f4671e3315a.png"]'
const payload = '[{"type":"image","url":"static/characters/06ea00fc-20c7-4364-880e-c0e161f4d4c4.png","role":"reference_image","label":"岑柚"},{"type":"image","url":"static/characters/5d227587-7c38-4de4-9888-4f4671e3315a.png","role":"reference_image","label":"沈芷兰"}]'

console.log('ref urls resolved:', await normalizeAistarslabReferenceUrls(raw))
console.log('content refs resolved:', await normalizeAistarslabContentRefs(payload))
