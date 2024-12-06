const { WebflowClient } = require("webflow-api");
require('dotenv').config();
const fetch = require("node-fetch");

// Constants
const samUrl = 'https://dev.api.symbuild.com.au/api';
const webflowUrl = 'https://api.webflow.com';
const webflowSiteID = process.env.WEBFLOW_SITE_ID;
const webflowKey = process.env.WEBFLOW_KEY;
const samKey = process.env.SAM_KEY;

// Headers for API requests
const samGetHeaders = {
  'Authorization': `Bearer ${samKey}`,
  'Content-Type': 'application/json'
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

async function getArtworks(token) {
  try {
    const searchRes = await fetch(`${samUrl}/v1.1/inventory/catalogue/search?hasStock=false`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    if (!searchRes.ok) {
      throw new Error(`Failed to fetch inventory catalogue: ${searchRes.statusText}`);
    }

    const searchJson = await searchRes.json();
    if (!searchJson.data || !Array.isArray(searchJson.data)) {
      throw new Error('Invalid search response format');
    }

    // Filter for only ARTWORK and EDITION types
    const validInventoryItems = searchJson.data.filter(item => 
      item.type === 'ARTWORK' || item.type === 'EDITION'
    );

    console.log(`Found ${validInventoryItems.length} valid inventory items`);

    const inventory_data = [];
    for (const item of validInventoryItems) {
      try {
        const detailRes = await fetch(`${samUrl}/v1.1/inventory/catalogue/detail?inventoryId=${item.inventory_id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!detailRes.ok) {
          console.error(`Failed to fetch details for inventory ID ${item.inventory_id}: ${detailRes.statusText}`);
          continue;
        }

        const detailJson = await detailRes.json();
        if (detailJson.code === 200 && detailJson.data) {
          // Only include items that have prices and are intended for the store
          if (detailJson.data.price_list && detailJson.data.price_list.length > 0) {
            inventory_data.push(detailJson.data);
            console.log(`Successfully fetched details for: ${detailJson.data.catalogue_no}`);
          } else {
            console.log(`Skipping ${detailJson.data.catalogue_no} - no price information`);
          }
        } else {
          console.error(`Invalid detail response for ID ${item.inventory_id}`);
        }
      } catch (error) {
        console.error(`Error fetching details for ID ${item.inventory_id}:`, error);
      }
    }

    console.log(`Successfully processed ${inventory_data.length} artworks`);
    return inventory_data;
  } catch (error) {
    console.error('Error in getArtworks:', error);
    throw error;
  }
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
    .filter(artwork => {
      if (!artwork || artwork.inventory_type === 'OTHER') {
        console.log(`Skipping non-artwork item: ${artwork?.catalogue_no}`);
        return false;
      }
      
      if (!artwork.price_list || artwork.price_list.length === 0) {
        console.log(`Skipping artwork without price: ${artwork.catalogue_no}`);
        return false;
      }

      const priceInfo = artwork.price_list[0];
      if (!priceInfo.retail_price || isNaN(parseFloat(priceInfo.retail_price))) {
        console.log(`Skipping artwork with invalid price: ${artwork.catalogue_no}`);
        return false;
      }

      return true;
    })
    .map(artwork => {
      try {
        const priceInfo = artwork.price_list[0];
        const price = parseFloat(priceInfo.retail_price) * 100;
        
        if (isNaN(price) || price < 0) {
          console.log(`Invalid price for artwork ${artwork.catalogue_no}: ${price}`);
          return null;
        }
        
        const artist = artwork.artists && artwork.artists[0] ? artwork.artists[0].name : '';
        
        const parts = [];
        
        if (artwork.category_name) {
          parts.push(`Category: ${artwork.category_name}`);
        }
        
        if (artwork.inventory_type === 'EDITION') {
          const editionMatch = artwork.catalogue_no.match(/\d+\/\d+$/);
          if (editionMatch) {
            parts.push(`Edition: ${editionMatch[0]}`);
          }
        }
      
        const formattedArtwork = {
          name: artwork.catalogue_no,
          description: parts.join('\n'),
          price: price,
          artist: artist,
          imageUrl: ''
        };

        if (artwork.default_image) {
          formattedArtwork.imageUrl = `https://dev.api.symbuild.com.au/api/${artwork.default_image}`;
        }

        return formattedArtwork;
      } catch (error) {
        console.error('Error formatting artwork:', error, artwork);
        return null;
      }
    })
    .filter(artwork => artwork !== null);
}

async function updateWebflow(artwork) {
  const url = `${webflowUrl}/sites/${webflowSiteID}/products`;
  
  const slug = artwork.name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  console.log('Processing artwork:', {
    name: artwork.name,
    slug: slug,
    price: artwork.price,
    artist: artwork.artist
  });

  const body = {
    "product": {
      "fields": {
        "name": artwork.name,
        "slug": slug,
        "description": artwork.description,
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
        "price": {
          "unit": "AUD",
          "value": artwork.price
        },
        "_archived": false,
        "_draft": false
      }
    }
  };

  if (artwork.imageUrl) {
    body.sku.fields["main-image"] = artwork.imageUrl;
  }

  if (artwork.artist) {
    body.product.fields["artist"] = artwork.artist;
  }

  try {
    console.log('Sending request to Webflow:', JSON.stringify(body, null, 2));
    
    const res = await fetch(url, {
      method: 'POST',
      headers: postHeaders,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('Webflow API Error:', {
        status: res.status,
        statusText: res.statusText,
        response: errorText
      });
      throw new Error(`Webflow API error (${res.status}): ${errorText}`);
    }

    const responseData = await res.json();
    console.log('Successfully created product in Webflow:', responseData);
    return responseData;
  } catch (error) {
    console.error('Error updating artwork in Webflow:', error);
    
    if (error.message.includes('429') || error.message.includes('rate limit')) {
      console.log('Rate limit hit, waiting before retry...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      return updateWebflow(artwork);
    }
    
    throw error;
  }
}

async function initialize() {
  try {
    console.log("Starting sync process...");
    
    const artworks = formatArtworks(await getArtworks(samKey));
    const webflowArtworks = await getWebflowArtworks();
    
    const filteredArtworks = artworks.filter((artwork) => {
      if (!artwork || !artwork.name) {
        console.log('Skipping invalid artwork:', artwork);
        return false;
      }
      
      const existingArtwork = webflowArtworks.find(webflowArtwork => 
        webflowArtwork.name === artwork.name && 
        webflowArtwork.artist === artwork.artist
      );
      
      return !existingArtwork;
    });

    console.log(`Found ${filteredArtworks.length} new artworks to process`);

    for (const artwork of filteredArtworks) {
      try {
        console.log(`Updating artwork: ${artwork.name}...`);
        await updateWebflow(artwork);
        // Add delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Failed to update artwork ${artwork.name}:`, error);
        continue;
      }
    }

    console.log("Sync process complete");
    process.exit(0);
  } catch (error) {
    console.error("Sync process error:", error);
    process.exit(1);
  }
}

// Run the sync
initialize().catch(error => {
  console.error("Fatal error during sync:", error);
  process.exit(1);
});