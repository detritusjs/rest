import * as DetritusRest from '../../lib';

(async () => {
  const client = new DetritusRest.Client();

  /*
  const body = new FormData();
  body.append('some', 'multipart data');
  */
  try {
    const response = await client.request({
      body: {
        some: 'multipart data',
      },
      method: 'post',
      multipart: true,
      url: 'https://nghttp2.org/httpbin/post',
    });
    const body = await response.json();
    console.log(body);
  } catch(error) {
    console.error(error);
  }
})();
