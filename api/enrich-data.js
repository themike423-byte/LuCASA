// Fallback enrichment for the few LEGACY Zillow rows still in the sheet, keyed by
// zpid. The real, automatic path is Redfin (see api/redfin.js) — new rows should
// be Redfin links and never touch this file. This only keeps old Zillow rows from
// going blank until they're swapped to Redfin links.
//
// Zillow's page HTML is blocked to servers, but its image CDN
// (photos.zillowstatic.com) is open, so these photos are stored as full CDN URLs.

const zimg = (hash) => `https://photos.zillowstatic.com/fp/${hash}-cc_ft_1536.jpg`;

module.exports = {
  "25992334": {
    address: "6457 Channing Dr, North Highlands, CA 95660",
    price: 339900, beds: 3, baths: 2, sqft: 972, lot: "6,098 sqft", year: 1956,
    coords: { lat: 38.684917, lng: -121.378136 },
    summary:
      "Ranch, built 1956. $350/sqft, Zestimate $340.3K, no HOA, taxes ~$1,788/yr. " +
      "Granite counters, tile floors, central air, detached 1-car garage, large " +
      "covered patio. Seller notes the 2nd bath + laundry may be unpermitted.",
    photos: [
      "d93602f910cec3f4024ea040de30f369",
      "733156b9d628149c1533d021f57def14",
      "842ef101e6891c11557700a259435e84",
      "085f632bc4c21884a151c2a0f04470d3",
      "b643408f228194f2cdd3eed6ba638c72"
    ].map(zimg)
  }
};
