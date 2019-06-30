const DetritusRest = require('../lib');

(async () => {
  const client = new DetritusRest.Client();

  try {
    const response = await client.request('https://nghttp2.org/httpbin/get');
    const body = await response.body();
    console.log(body);
  } catch(error) {
    console.error(error);
  }
})();
