# sam-webflow-sync 🔁

This script syncs artworks between the SAM database
([sam.org.au](https://sam.org.au) – which has its own CMS for managing artworks
and their price/sold status/description/etc.) and the Hermannsburg Potters CMS
in Webflow.

It syncs one-way, and once per artwork. This means when an artwork is added on
the CMS, it will appear on the website. However, changes on the Webflow CMS don't
change the artwork on SAM, and changes on SAM after the artwork has been synced
don't sync back to the Webflow CMS.

## Conditions for sync

Do be synced, an artwork in SAM must:

- Have 'Web active' ticked
- Have an artist name & title

## Environment variables

You'll need to define a few env vars to get this working:

- `SAM_KEY`: the API key from sam.org.au (request it there)
- `WEBFLOW_KEY`: Webflow API key, [here's how to get
  it](https://elfsight.com/blog/2021/05/webflow-cms-api-integrations-and-documentation/)
- `WEBFLOW_SITE_ID`: The site ID in Webflow. It's dumb, but
  [this](https://www.briantsdawson.com/blog/webflow-api-how-to-get-site-collection-and-item-ids-for-zapier-and-parabola-use)
  is the fastest way to get it. Otherwise, ping the API endpoint manually to get a list
  of sites, and find the ID for your target site.

## How it works

The `main()` function runs when you call `node index.js`. This triggers the rest
of the functions, getting a list of artworks from SAM, then getting the artworks
from Webflow. These two lists are cross-referenced, and any missing artworks are
formatted for Webflow's CMS and then uploaded.

The `getArtworks()` function fetches all artworks from the SAM API.

The `getWebflowArtworks()` function fetches all artworks from the Webflow API.

The `formatArtworks(artworks)` function removes common HTML tags from the
descriptions (which are plain text in Webflow) and formats all the fields for
what Webflow is expecting.

Finally, the `updateWebflow(artwork)` function creates the JSON request to push
the artwork to the CMS, and initiates the request with Webflow.

## Deployment

I deployed this to Render.com as a cron job, with the schedule `0 * * * *`
(every hour). The code can be run with `yarn start`.

## Caveats

There is no error handling in this script currently. However, it's not
completely necessary – if it fails, there are no side effects, and any issues
should appear in the logs for troubleshooting.

It would be good in future to implement more robust syncing (including syncing
updates from the SAM API and sold status), and error reporting so that if the
sync fails someone can be notified to fix it.

## Original author

Rupert Parry <rp@rupert.cloud> on behalf of Kopi Su Studio.