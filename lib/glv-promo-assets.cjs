// Current configured source references, NOT historical asset delivery evidence.
const CREATIVE_FIELDS = 'creative{id,image_hash,video_id,object_story_spec,asset_feed_spec,media_sourcing_spec,effective_object_story_id,object_story_id,platform_customizations,degrees_of_freedom_spec}';
const {INVENTORY_VERSION} = require('../public/glv-meta-ads/promo-format.js');
function parseCreative(creative, account) {
  const found = new Map(), reasons = new Set(), alternate = [];
  const add = (kind,id,path) => {
    if (typeof id !== 'string' || !id.trim() || (kind === 'image' && !account)) { reasons.add('unresolved_media_identity'); return; }
    const key = kind === 'image' ? `image:${account}:${id}` : `video:${id}`;
    if (!found.has(key)) found.set(key,{kind,id,key,source_paths:[]});
    found.get(key).source_paths.push(path);
  };
  const c = creative || {}, s = c.object_story_spec || {}, f = c.asset_feed_spec || {};
  // Shape, not a successfully resolved ID, establishes thumbnail context.
  const videoShaped = node => Boolean(node && (Object.hasOwn(node,'video_id') || Object.hasOwn(node,'video_data') || ['type','media_type','object_type'].some(key=>typeof node[key] === 'string' && /^video(?:_|$)/i.test(node[key]))));
  const m = c.media_sourcing_spec;
  if (m !== undefined && (!m || typeof m !== 'object' || Array.isArray(m))) reasons.add('unsupported_media_sourcing_spec');
  const videoContext = videoShaped(c) || videoShaped(s) || videoShaped(s.link_data) || [f,m].some(spec=>spec && spec.videos !== undefined && (!Array.isArray(spec.videos) || spec.videos.length > 0));
  for (const [source,spec] of [['asset_feed_spec',f],['media_sourcing_spec',c.media_sourcing_spec || {}]]) {
    for (const [list,kind,field] of [['images','image','hash'],['videos','video','video_id']]) {
      if (spec[list] !== undefined && !Array.isArray(spec[list])) reasons.add('unsupported_media_list');
      for (const item of Array.isArray(spec[list]) ? spec[list] : []) add(kind,item?.[field],`${source}.${list}.${field}`);
    }
  }
  if (Object.hasOwn(s,'video_data')) add('video',s.video_data?.video_id,'object_story_spec.video_data.video_id');
  if (s.photo_data) add('image',s.photo_data.image_hash,'object_story_spec.photo_data.image_hash');
  const link = s.link_data;
  if (link && Object.hasOwn(link,'child_attachments')) {
    if (!Array.isArray(link.child_attachments) || !link.child_attachments.length) reasons.add('unsupported_carousel');
    else for (const child of link.child_attachments) {
      if (!child || typeof child !== 'object') { reasons.add('unresolved_carousel_media'); continue; }
      if (videoShaped(child)) add('video',child.video_id,'object_story_spec.link_data.child_attachments.video_id');
      else if (child.image_hash) add('image',child.image_hash,'object_story_spec.link_data.child_attachments.image_hash');
      else reasons.add('unresolved_carousel_media');
    }
  } else if (videoShaped(link)) add('video',link.video_id,'object_story_spec.link_data.video_id');
  else if (link?.image_hash) add('image',link.image_hash,'object_story_spec.link_data.image_hash');
  else if (link && !found.size) reasons.add('link_media_unresolved');
  if (!found.size && !(link && Object.hasOwn(link,'child_attachments'))) {
    if (videoShaped(c)) add('video',c.video_id,'video_id');
    else if (c.image_hash && !videoContext) add('image',c.image_hash,'image_hash');
  } else if (c.video_id && (typeof c.video_id !== 'string' || !found.has(`video:${c.video_id}`))) {
    if (typeof c.video_id === 'string' && c.video_id.trim()) alternate.push(c.video_id);
    else reasons.add('unresolved_media_identity');
    reasons.add('top_level_video_id_differs_from_source_video:alias_unresolved');
  }
  if (!found.size) reasons.add(c.effective_object_story_id || c.object_story_id ? 'existing_post_unresolved' : 'media_unavailable');
  if (s.template_data || c.product_set_id || f.product_set_id) reasons.add('unsupported_catalog_template');
  if (c.platform_customizations && Object.keys(c.platform_customizations).length) reasons.add('unsupported_platform_customizations');
  if (c.degrees_of_freedom_spec && Object.keys(c.degrees_of_freedom_spec).length) reasons.add('generated_enhancements_unresolved');
  return {version:INVENTORY_VERSION,assets:[...found.values()],alternate_video_ids_not_counted:alternate,configured_media_complete:reasons.size === 0,unknown_reasons:[...reasons]};
}
module.exports = {parseCreative,CREATIVE_FIELDS};
