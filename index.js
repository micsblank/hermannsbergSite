const { WebflowClient } = require("webflow-api");
require('dotenv').config();
const fetch = require("node-fetch");
const express = require('express');


// Express app setup
const app = express();
app.use(express.json());

// Constants
const samUrl = 'https://dev.api.symbuild.com.au/api';
const webflowUrl = 'https://api.webflow.com';
const webflowSiteID = process.env.WEBFLOW_SITE_ID;
const webflowKey = process.env.WEBFLOW_KEY;
const samKey = process.env.SAM_KEY_V3;
const webFlowSamGetOrder = process.env.SAM_API_FROM_WEBFLOW;

// Initialize Webflow client
const client = new WebflowClient({ accessToken: webFlowSamGetOrder });

// Authentication headers
const samSimpleAuth = {
  'Authorization': 'Basic ' + Buffer.from('MicaelaB:Claypot101').toString('base64'),
};

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

async function setupWebflowWebhook() {
  try {
    await client.webhooks.create(webflowSiteID, {
      triggerType: "ecomm_new_order",
      url: `${process.env.WEBHOOK_URL}/webhook`  // Make sure to set WEBHOOK_URL in .env
    });
    console.log("Webhook created successfully.");
  } catch (error) {
    console.error("Error creating webhook:", error);
  }
}

async function login() {
  const res = await fetch(`${samUrl}/v1/auth/login`, {
    method: 'POST',
    headers: samSimpleAuth,
    body: JSON.stringify({})
  });
  const json = await res.json();
  return json.token;
}

async function createCustomer(orderData) {
  try {
    const { customerInfo, shippingAddress, billingAddress } = orderData;
    const nameParts = customerInfo.fullName.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Prepare address object
    const addressObject = {
      address: shippingAddress.address1,
      type: "SHIPPING",
      is_default: true,
      suburb: shippingAddress.city,
      state: shippingAddress.state,
      postcode: shippingAddress.zipCode
    };

    // If billing address is different, add it too
    const addresses = [addressObject];
    if (billingAddress && billingAddress.address1 !== shippingAddress.address1) {
      addresses.push({
        address: billingAddress.address1,
        type: "BILLING",
        is_default: false,
        suburb: billingAddress.city,
        state: billingAddress.state,
        postcode: billingAddress.zipCode
      });
    }

    const customerPayload = {
      institute_type: "retail",
      name_of_institute: "Hermannsberg Pottery", // Default institute name
      contacts: [
        {
          contact_type: "CUSTOMER",
          first_name: firstName,
          last_name: lastName,
          email: customerInfo.email,
          phone_mobile: customerInfo.phone || "",
          is_licensor: false,
          is_purchased_online: true,
          is_main_contact: true,
          addresses: addresses
        }
      ]
    };

    const response = await fetch(`${samUrl}/v1/customer`, {
      method: 'POST',
      headers: {
        ...samGetHeaders,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(customerPayload)
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Failed to create customer: ${errorData}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error creating customer:', error);
    throw error;
  }
}

async function createOrderInSAM(orderData, customerResponse) {
  try {
    const orderPayload = {
      customer_id: customerResponse.id,
      order_date: new Date().toISOString(),
      items: orderData.items.map(item => ({
        inventory_id: item.product.inventory_id,
        quantity: item.quantity,
        unit_price: parseFloat(item.price)
      })),
      payment_method: orderData.paymentMethod || "ONLINE",
      order_status: 'CONFIRMED'
    };

    const response = await fetch(`${samUrl}/v1/transactions/sales/order`, {
      method: 'POST',
      headers: samGetHeaders,
      body: JSON.stringify(orderPayload)
    });

    if (!response.ok) {
      throw new Error(`Failed to create order in SAM: ${await response.text()}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error creating order:', error);
    throw error;
  }
}

async function handleNewOrderWebhook(req, res) {
  try {
    console.log('Received webhook from Webflow:', req.body);
    
    // Create customer first
    const customerResponse = await createCustomer(req.body);
    console.log('Customer created in SAM:', customerResponse);
    
    // Create order in SAM
    const orderResponse = await createOrderInSAM(req.body, customerResponse);
    console.log('Order created in SAM:', orderResponse);
    
    res.status(200).json({
      message: 'Order processed successfully',
      customerId: customerResponse.id,
      orderId: orderResponse.id
    });
  } catch (error) {
    console.error('Error handling webhook:', error);
    res.status(500).json({
      error: 'Error processing order',
      details: error.message
    });
  }
}

// Your existing getArtworks, formatArtworks, and updateWebflow functions here...
// [Previous implementation remains the same]

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
      console.log("online:", artwork.enable_online_store)
      console.log(artwork);
      // if (!artwork.enable_online_store) {
      //   console.log(`Skipping ${artwork.catalogue_no} - online store not enabled`);
      //   return false;
      // }

      if (!artwork || artwork.inventory_type === 'OTHER') {
        console.log(`Skipping non-artwork item: ${artwork?.catalogue_no}`);
        return false;
      }
      
      if (!artwork.price_list || artwork.price_list.length === 0) {
        console.log(`Skipping artwork without price: ${artwork.catalogue_no}`);
        return false;
      }

      // Check if the artwork has a valid price
      const priceInfo = artwork.price_list[0];
      if (!priceInfo.retail_price || isNaN(parseFloat(priceInfo.retail_price))) {
        console.log(`Skipping artwork with invalid price: ${artwork.catalogue_no}`);
        return false;
      }

      return true;
    })
    .map(artwork => {
      try {

        
        
        // Get the retail price info
        const priceInfo = artwork.price_list[0];
        const price = parseFloat(priceInfo.retail_price) * 100;
        
        // Ensure price is valid
        if (isNaN(price) || price < 0) {
          console.log(`Invalid price for artwork ${artwork.catalogue_no}: ${price}`);
          return null;
        }
        
        // Get artist info - defaulting to empty string if no artist
        const artist = artwork.artists && artwork.artists[0] ? artwork.artists[0].name : '';
        
        // Format description
        const parts = [];
        
        // Add category
        if (artwork.category_name) {
          parts.push(`Category: ${artwork.category_name}`);
        }
        
        // Add edition info for prints
        if (artwork.inventory_type === 'EDITION') {
          const editionMatch = artwork.catalogue_no.match(/\d+\/\d+$/);
          if (editionMatch) {
            parts.push(`Edition: ${editionMatch[0]}`);
          }
        }
      
        // Create the formatted artwork object
        const formattedArtwork = {
          name: artwork.catalogue_no,
          description: parts.join('\n'),
          price: price,
          artist: artist,
          imageUrl: '' // Initialize with an empty string
        };

        // Assign the imageUrl if artwork.default_image exists
        if (artwork.default_image) {
          formattedArtwork.imageUrl = `https://dev.api.symbuild.com.au/api/${artwork.default_image}`;
        }

        // console.log('Formatted artwork:', formattedArtwork);
        return formattedArtwork;
      } catch (error) {
        console.error('Error formatting artwork:', error, artwork);
        return null;
      }
    })
    .filter(artwork => artwork !== null);
}

function formatTitle(title) {
  return title.replace(/[\(\),]/g, '');
}

async function getExistingProduct() {
  try {
    // First get all products
    const url = `${webflowUrl}/sites/${webflowSiteID}/products`;
    const res = await fetch(url, {
      method: 'GET',
      headers: getHeaders
    });
    
    if (!res.ok) {
      throw new Error(`Failed to fetch products: ${res.statusText}`);
    }
    
    const products = await res.json();
    console.log('Example of existing product structure:', JSON.stringify(products.items[0], null, 2));
    return products.items[0]; // Return first product as example
  } catch (error) {
    console.error('Error fetching existing product:', error);
    throw error;
  }
}

async function updateWebflow(artwork) {
  const url = `${webflowUrl}/sites/${webflowSiteID}/products`;
  
  // Sanitize the slug
  const slug = artwork.name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  console.log('Processing artwork:', {
    name: artwork.name,
    slug: slug,
    price: artwork.price,
    artist: artwork.artist
  });

  // Create product without trying to manage inventory settings
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

  // Only add image if it exists
  if (artwork.imageUrl) {
    body.sku.fields["main-image"] = artwork.imageUrl;
  }

  // Only add artist if it exists
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
// Update the initialize function to handle errors better
async function initialize() {
  try {
    const token = await login();
    console.log("Login successful");
    
    // Setup webhook for new orders
    await setupWebflowWebhook();
    
    const artworks = formatArtworks(await getArtworks(token));
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
        // Continue with next artwork instead of stopping the whole process
        continue;
      }
    }

    console.log("Initialization complete");
  } catch (error) {
    console.error("Initialization error:", error);
    // If this is a critical error, you might want to exit the process
    process.exit(1);
  }
}

// Setup webhook endpoint
app.post('/webhook', handleNewOrderWebhook);

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  initialize().catch(console.error);
});