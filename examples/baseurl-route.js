const DetritusRest = require('../lib');

(async () => {
  const client = new DetritusRest.Client({
    baseUrl: 'https://nghttp2.org',
  });

  try {
    const response = await client.request({
      route: {
        method: 'get',
        path: '/httpbin/:someVariable',
        params: {
          someVariable: 'get',
        },
      },
    });
    const body = await response.json();
    console.log(response, body);
  } catch(error) {
    console.error(error);
  }
})();
