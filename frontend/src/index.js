import React from 'react';
import ReactDOM from 'react-dom';
import 'bootstrap/dist/css/bootstrap.css';
import Container from 'react-bootstrap/Container';
import Form from 'react-bootstrap/Form';
import Button from 'react-bootstrap/Button';
import InputGroup from 'react-bootstrap/InputGroup';
import ListGroup from 'react-bootstrap/ListGroup';
import './index.css';
import BN from 'bn.js';
import { Keccak } from 'sha3';
import config from './config.json';

const hash = new Keccak(256);

// Adapted from geth's implementation

/**
 * Checks if the given string is an address
 *
 * @method isAddress
 * @param {String} address the given HEX adress
 * @return {Boolean}
*/
var isAddress = function (address) {
    if (!/^(0x)?[0-9a-f]{40}$/i.test(address)) {
        // check if it has the basic requirements of an address
        return false;
    } else if (/^(0x)?[0-9a-f]{40}$/.test(address) || /^(0x)?[0-9A-F]{40}$/.test(address)) {
        // If it's all small caps or all all caps, return true
        return true;
    } else {
        // Otherwise check each case
        return isChecksumAddress(address);
    }
};

/**
 * Checks if the given string is a checksummed address
 *
 * @method isChecksumAddress
 * @param {String} address the given HEX adress
 * @return {Boolean}
*/
var isChecksumAddress = function (address) {
    // Check each case
    address = address.replace("0x", "");
    hash.reset();
    hash.update(address.toLowerCase());
    var addressHash = hash.digest("hex");
    for (var i = 0; i < 40; i++ ) {
        // the nth letter should be uppercase if the nth digit of casemap is 1
        if ((parseInt(addressHash[i], 16) > 7 && address[i].toUpperCase() !== address[i]) ||
            (parseInt(addressHash[i], 16) <= 7 && address[i].toLowerCase() !== address[i])) {
            return false;
        }
    }
    return true;
};

function onlyUnique(value, index, self) {
    return self.indexOf(value) === index;
}

function blockchainEncodeAddress(address) {
    if (!/^(0x)/.test(address)) {
        address = "0x" + address;
    }
    return address.toLowerCase();
}

class NftFile extends React.Component {
    constructor(props) {
        super(props);
        this.state = { metadata: {} };

        fetch(this.props.uri).then(response => {
            if (!response.ok) throw new Error("Unable to fetch metadata: " + response.status);
            return response.json();
        }).then(json => {
            this.setState({ metadata: json });
            console.dir(json);
        }).catch(console.error);
    }

    render() {
        return this.state.metadata.hasOwnProperty("name") ?(
            <div>
                <p>Name: {this.state.metadata["name"]} &nbsp;&nbsp;&nbsp;&nbsp;Description: {this.state.metadata["description"]}</p>
                <img src={this.state.metadata["image"]} />
            </div>
        ) : (<div></div>);
    }
}

class NftDisplay extends React.Component {
    constructor(props) {
        super(props);
        this.state = { uris: [] };

        fetch(`${config.backend}/tokens-for?contract=${props.contract}&owner=${props.owner}`).then(response => {
            if (!response.ok) throw new Error("Unable to talk to backend: " + response.status);
            return response.json();
        }).then(json => {
            this.setState({ uris: json["uris"] });
        }).catch(console.error);
    }

    render() {
        return (
            <div>
                <ListGroup>
                    {this.state.uris.map(uri => (
                        <ListGroup.Item key={uri} className="mt-3">
                            <NftFile uri={uri}/>
                        </ListGroup.Item>
                    ))}
                </ListGroup>
            </div>
        );
    }
}

class ContractList extends React.Component {
    render() {
        return (
            <ListGroup>
                {this.props.contracts.map(contract => (
                    <ListGroup.Item key={contract}>
                        {contract} <Button type="button" onClick={() => this.props.remover(contract)}>Remove</Button>
                        <NftDisplay contract={contract} owner={this.props.owner} />
                    </ListGroup.Item>
                    // TODO I need to interact with the smart contract here somehow
                    // (either via the server which is simpler or using the metamask injected api, which seems prefered but requires that metamask be present)
                ))}
            </ListGroup>
        );
    }
}

class Viewer extends React.Component {
    constructor(props) {
        super(props);
        this.state = { address: "", contracts: [], contractAddress: "" };
        this.handleAddressChange = this.handleAddressChange.bind(this);
        this.handleContractChange = this.handleContractChange.bind(this);
        this.connectToMetamask = this.connectToMetamask.bind(this);
        this.addContract = this.addContract.bind(this);
        this.remover = this.remover.bind(this);

        fetch(`${config.backend}/which-rpc`).then(response => {
            if (!response.ok) throw new Error("Unable to talk to backend: " + response.status);
            return response.json();
        }).then(json => document.title = `NFTs on ${json["rpc"].split("//")[1]}`).catch(console.error);
    }

    handleAddressChange(e) {
        this.setState({ address: e.target.value });
    }

    handleContractChange(e) {
        this.setState({ contractAddress: e.target.value });
    }

    remover(address) {
        this.setState(state => { return { contracts: state.contracts.filter(contract => contract !== address) }});
    }

    addContract(e) {
        e.preventDefault();
        let addr = this.state.contractAddress;
        if (!isAddress(addr)) return;
        addr = blockchainEncodeAddress(addr)
        this.setState(state => { return { contracts: state.contracts.concat(addr).filter(onlyUnique) }});
    }

    connectToMetamask() {
        window.ethereum.request({ method: "eth_requestAccounts" })
            .then(accounts => {
                this.setState({ address: accounts[0] });
            })
            .catch(err => console.dir(["metamask error", err]));
    }

    handleSubmit(e) {
        e.preventDefault();
    }

    render() {
        return (
            <div>
                <Container>
                    <Form onSubmit={this.handleSubmit} className="mt-5">
                        <InputGroup>
                            <Button onClick={this.connectToMetamask} >Connect with Metamask</Button>
                            <Form.Control type="text" placeholder="Or Input Wallet Address" onChange={this.handleAddressChange} value={this.state.address} />
                        </InputGroup>
                    </Form>
                </Container>
                {isAddress(this.state.address) && <Container className="mt-2">
                    <ContractList contracts={this.state.contracts} remover={this.remover} owner={this.state.address}/>
                    <Form onSubmit={this.addContract} className="mt-2">
                        <Form.Control type="text" placeholder="Contract Address" onChange={this.handleContractChange} value={this.state.contractAddress} />
                    </Form>
                </Container>}
            </div>
        );
    }
}

class Transaction extends React.Component {
    constructor(props) {
        super(props);
        this.state = { valid: false, mintAddress: "", address: "", invalid: false };

        // This needs refactoring probably
        fetch(`${config.backend}/payment?uid=${this.props.uid}`).then(response => {
            if (!response.ok) throw new Error("Unable to access backend: " + response.status);
            return response.json();
        }).then(json => {
            this.setState({ valid: json, invalid: !json });
            if (!json) return;
            fetch(`${config.backend}/mint-address`).then(response => {
                if (!response.ok) throw new Error("Unable to access backend: " + response.status);
                return response.text();
            }).then(text => {
                this.setState({ mintAddress: text });

                if (window.ethereum) {
                    window.ethereum.request({ method: "eth_requestAccounts" })
                        .then(accounts => {
                            this.setState({ address: accounts[0] });
                            fetch(`${config.backend}/set-payment-uid-address?uid=${this.props.uid}&address=${accounts[0]}`).then(response => {
                                if (!response.ok) throw new Error("Unable to access backend: " + response.status);
                                return response.json();
                            }).then(async json => {
                                if (json == false) throw new Error("Invalid request or something");
                                try {
                                    // switch chains
                                    await window.ethereum.request({
                                        method: "wallet_addEthereumChain",
                                        params: [
                                            {
                                                chainId: "0x6357D2E0",
                                                chainName: "ONE",
                                                rpcUrls: ["https://api.s0.b.hmny.io"],
                                            },
                                        ],
                                    });
                                    const transactionParameters = {
                                        // gasPrice: "30000", // Metamask will estimate this for us
                                        gas: "210000", // idk man
                                        to: this.state.mintAddress,
                                        from: accounts[0],
                                        value: "0x100000000000000", // TODO get figuring this value out somehow (it needs to pay for the minting costs which the backend has yet to preform)
                                    };
                            
                                    const txid = await window.ethereum.request({
                                        method: "eth_sendTransaction",
                                        params: [transactionParameters],
                                    });
        
                                    fetch(`${config.backend}/txid-for-uid?uid=${this.props.uid}&txid=${txid}`).then(response => {
                                        if (!response.ok) throw new Error("Unable to access backend: " + response.status);
                                        return response.json();
                                    }).then(json => {
                                        if (!json) throw new Error("Unable to communicate transaction id (This is a real problem and it mean the server will not look for the transaction even though it has already completed)");
                                        this.props.setViewing(true);
                                        window.location.search = "";
                                    }).catch(console.error);
                                } catch (addError) {
                                    console.dir(addError)
                                }
                            }).catch(console.error);
                        })
                        .catch(err => console.dir(["metamask error", err]));
                } else {
                    alert("Metamask missing");
                }
            }).catch(console.error);
        }).catch(console.error);
    }

    render() {
        return (
            <div>
                {this.state.valid && this.state.mintAddress.length > 0 && <p>Address of minting is {this.state.mintAddress}</p>}
                {this.state.invalid && <p>This link appears to be invalid. (It has possibly already been used as these are one time use links.)</p>}
            </div>
        );
    }
}

class Page extends React.Component {
    constructor(props) {
        super(props);
        this.state = { viewing: window.location.search.length === 0 };
        this.setViewing = this.setViewing.bind(this);
    }

    setViewing(viewing) {
        this.setState({ viewing: viewing });
    }

    render() {
        return (
            <div>
                { this.state.viewing ? <Viewer /> : <Transaction setViewing={this.setViewing} uid={window.location.search.split("=")[1]} />}
            </div>
        );
    }
}

ReactDOM.render(
    (
        <div className="p-3">
            <Page />
        </div>
    ),
    document.getElementById("root")
);