const DetritusRest = require('../lib');

(async () => {
  const client = new DetritusRest.Client();

  try {
    const response = await client.request({
      body: {
        some: 'json',
      },
      method: 'post',
      url: 'https://nghttp2.org/httpbin/post',
    });
    const body = await response.json();
    console.log(body);
  } catch(error) {
    console.error(error);
  }
})();
