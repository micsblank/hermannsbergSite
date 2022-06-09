//@ts-nocheck

require('dotenv').config()
const fetch = require("node-fetch")

const samUrl = 'https://apiv2.sam.org.au'
const webflowUrl = 'https://api.webflow.com'
const webflowSiteID = process.env.WEBFLOW_SITE_ID
const webflowKey = process.env.WEBFLOW_KEY
const samKey = process.env.SAM_KEY

const samGetHeaders = {
  'Authorization': `Bearer ${samKey}`,
}

const postHeaders = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'Authorization': `Bearer ${webflowKey}`,
  'Accept-Version': '1.0.0'
}

const getHeaders = {
  'Authorization': `Bearer ${webflowKey}`,
  'Accept-Version': '1.0.0'
}

const myArtwork = {
  name: 'Test Artwork',
  description: 'My artwork',
  price: 12500,
  artist: 'My Artist',
  imageUrl: 'https://royaldesign.com/image/11/knabstrup-keramik-earth-vase-vit-2?w=2560&quality=80'
}


async function main() {
  const artworks = await getArtworks()
  console.log(artworks)
  const names = await getWebflowArtworkNames()

  artworks
    .filter(artwork => !names.includes(artwork.StoryTitle))
    .map(artwork => {
      const imageUrl = artwork.images ? artwork.images[0] : ''
      return {
        name: artwork.StoryTitle.replace('(', '').replace(')', ''),
        description: artwork.StoryNarrative.replace('<p>', '').replace('</p>', ''),
        price: artwork.SaleAmount * 100,
        artist: artwork.Firstname + ' ' + artwork.Surname,
        imageUrl: imageUrl
      }
    })
    .forEach((artwork) => {
      console.log(`Updating artwork: ${artwork.name}...`)
      updateWebflow(artwork)
    })
}
main()

async function getArtworks() {
  const res = await fetch(`${samUrl}/store/items?ignoreCategories=true`, { headers: samGetHeaders })
  const json = await res.json()
  return json.artworks
}

async function getWebflowArtworkNames(siteId) {
  const url = `${webflowUrl}/sites/${webflowSiteID}/products`
  const res = await fetch(url, { method: 'GET', headers: getHeaders })
  const json = await res.json()
  const names = json.items.map(i => i.product.name)
  return names
}

async function updateWebflow(artwork) {
  const url = `${webflowUrl}/sites/${webflowSiteID}/products`
  const slug = artwork.name.split(' ').join('-').toLowerCase()

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
        "main-image": "https://royaldesign.com/image/11/knabstrup-keramik-earth-vase-vit-2?w=2560&quality=80",
        "price": {
          "unit": "AUD",
          "value": artwork.price
        },
        "_archived": false,
        "_draft": false
      }
    }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: postHeaders,
    body: JSON.stringify(body)
  })
}