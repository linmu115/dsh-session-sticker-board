# 0.4.6 - Stable Sidebar deep links

- Remove the deep-link workaround that clicked Better Sidebar's panel toggle through the DOM.
- Keep the current Sidebar state stable while deep links switch sessions, locate anchors, and open sticker or annotation details.
- Add a package-boundary regression guard against reintroducing Sidebar toggle ownership.
