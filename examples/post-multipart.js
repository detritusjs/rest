const DetritusRest = require('../lib');

(async () => {
  const client = new DetritusRest.Client();

  /*
  const body = DetritusRest.MultipartFormData();
  body.add('some', 'multipart');
  */
  try {
    const response = await client.request({
      body: {
        some: 'multipart',
      },
      method: 'post',
      multipart: true,
      url: 'https://nghttp2.org/httpbin/post',
    });
    const body = await response.body();
    console.log(body);
  } catch(error) {
    console.error(error);
  }
})();
