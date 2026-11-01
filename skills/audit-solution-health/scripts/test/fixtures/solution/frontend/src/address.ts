export async function lookup(q: string) {
  const r = await fetch(`https://api.dataforsyningen.dk/autocomplete?q=${q}`);
  return r.json();
}
const maps = "https://maps.googleapis.com/maps/api/js?key=XYZ";
// docs: https://developer.mozilla.org/en-US/docs/Web/API/fetch
