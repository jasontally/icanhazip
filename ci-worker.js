// SPDX-License-Identifier: MIT
//
// This project ships a Cloudflare Snippet, not a Worker, so this file is not
// the product. It exists because Cloudflare's CI has no other shape to hang a
// build on: Workers Builds connects a repository to a Worker, and the build and
// deploy commands configured on that Worker are what run. See wrangler.jsonc
// and the "Build and deploy on Cloudflare" section of the README.
//
// Nothing routes here and the deploy command never publishes it. It is uploaded
// once, by hand, to create the Worker that the repository connects to.
export default {
	fetch() {
		return new Response("icanhazip deploys a Snippet and DNS records, not a Worker.\n", {
			headers: { "content-type": "text/plain" },
		});
	},
};
