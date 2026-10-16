import { render } from "solid-js/web";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("index.html is missing #root");
render(() => <App />, root);
