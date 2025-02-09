require('dotenv').config();
const fetch = require("node-fetch");

const samUrl = 'https://apiv2.sam.org.au';
const webflowUrl = 'https://api.webflow.com';
const webflowSiteID = process.env.WEBFLOW_SITE_ID;
const webflowKey = process.env.WEBFLOW_KEY;
const samKey = process.env.SAM_KEY;

const samGetHeaders = {
  'Authorization': `Bearer ${samKey}`,
};

const postHeaders = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'Authorization': `Bearer ${webflowKey}`,
  'Accept-Version': '1.0.0'
};

const getHeaders = {
  'Authorization': `Bearer ${webflowKey}`,
  'Accept-Version': '1.0.0'
};

async function main() {
  const artworks = formatArtworks(await getArtworks());
  const webflowArtworks = await getWebflowArtworks();
  const filteredArtworks = artworks.filter((artwork) => {
    let match = false;
    webflowArtworks.forEach((webflowArtwork) => {
      if (
        webflowArtwork.name == artwork.name &&
        webflowArtwork.artist == artwork.artist
      ) {
        match = true;
      }
    });
    return !match;
  });

  filteredArtworks.forEach((artwork) => {
    if (!artwork.name || !artwork.artist) return;
    console.log(`Updating artwork: ${artwork.name}...`);
    updateWebflow(artwork);
  });
}
main();

async function getArtworks() {
  const res = await fetch(`${samUrl}/store/items?ignoreCategories=true`, { headers: samGetHeaders });
  const json = await res.json();
  return json.artworks;
}

async function getWebflowArtworks() {
  const url = `${webflowUrl}/sites/${webflowSiteID}/products`;
  const res = await fetch(url, { method: 'GET', headers: getHeaders });
  const json = await res.json();
  const artworks = json.items.map(i => i.product);
  return artworks;
}

function formatArtworks(artworks) {
  return artworks
    .map(artwork => {
      const imageUrl = artwork['Images'] ? artwork['Images'][0]['variants'][0]['URL'] : '';
      let desc = artwork.StoryNarrative;

      desc = desc.replace('<p>', '').replace('</p>', '');
      desc = desc.replace('<br>', '').replace('<br />', '').replace('<br/>', '');
      desc = desc.replace('<b>', '').replace('</b>', '');
      desc = desc.replace('<strong>', '').replace('</strong>', '');
      desc = desc.replace('<i>', '').replace('</i>', '');
      desc = desc.replace('<em>', '').replace('</em>', '');
      desc = desc.replace('&nbsp;', ' ');

      if (artwork.Medium && artwork.ArtworkSize) {
        desc = desc + ` (${artwork.Medium}, ${artwork.ArtworkSize})`;
      }

      return {
        name: formatTitle(artwork.StoryTitle),
        description: desc,
        price: artwork.SaleAmount * 100,
        artist: artwork.Firstname + ' ' + artwork.Surname,
        imageUrl: imageUrl
      };
    });
}

function formatTitle(title) {
  return title.replace('(', '').replace(')', '').replace(',', '');
}

async function updateWebflow(artwork) {
  const url = `${webflowUrl}/sites/${webflowSiteID}/products`;
  const slug = artwork.name.split(' ').join('-').toLowerCase();

  const body = {
    "product": {
      "fields": {
        "name": artwork.name,
        "slug": slug,
        "description": artwork.description,
        "sku-properties": [
          {
            "id": null,
            "name": "Original",
            "enum": [
              {
                "id": null,
                "name": "Original",
                "slug": "original"
              }
            ]
          }
        ],
        "artist": artwork.artist,
        "shippable": true,
        "_archived": false,
        "_draft": false
      }
    },
    "sku": {
      "fields": {
        "name": artwork.name,
        "slug": slug,
        "sku-values": {},
        "main-image": artwork.imageUrl,
        "price": {
          "unit": "AUD",
          "value": artwork.price
        },
        "_archived": false,
        "_draft": false
      }
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: postHeaders,
    body: JSON.stringify(body)
  });
}
