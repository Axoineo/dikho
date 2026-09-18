async function test() {
  try {
    // We don't know a valid fileId, so let's just make a dummy request
    const res = await fetch('http://localhost:5173/api/catalogue/files/invalid-id/view'); 
    console.log(res.status);
  } catch (e) { console.error(e); }
}
test();
