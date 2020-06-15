const DetritusRest = require('../lib');

(async () => {
  const client = new DetritusRest.Client();

  try {
    const response = await client.request({
      method: 'delete',
      url: 'https://nghttp2.org/httpbin/delete',
    });
    const body = await response.json();
    console.log(body);
  } catch(error) {
    console.error(error);
  }
})();
