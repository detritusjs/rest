const DetritusRest = require('../lib');

(async () => {
  const client = new DetritusRest.Client({
    baseUrl: 'https://nghttp2.org',
  });

  try {
    const response = await client.request({
      path: '/httpbin/get',
    });
    const body = await response.body();
    console.log(body);
  } catch(error) {
    console.error(error);
  }
})();
