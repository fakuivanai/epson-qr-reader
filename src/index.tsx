import { render } from "solid-js/web";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("index.html is missing #root");
render(() => <main />, root);
