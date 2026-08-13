export function shouldSkipSearchRender(event) {
  if (!event?.target || event.target.id !== 'dish-search') return false
  return event.isComposing === true || event.type === 'compositionstart' || event.type === 'compositionupdate'
}
