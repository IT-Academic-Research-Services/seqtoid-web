require "rails_helper"

RSpec.describe ApplicationHelper, type: :helper do
  describe "#escape_json" do
    # escape_json is used as JSON.parse('<%= raw escape_json(x) %>') in views, so it
    # must (a) JSON-serialize the argument, (b) neutralize </script> / < > & so it
    # can't break out of an inline <script>, and (c) escape ' and \ so it is safe
    # inside the single-quoted JS string literal.

    it "serializes a hash to JSON and escapes script-breaking characters" do
      result = helper.escape_json({ "key" => "</script><script>alert(1)</script>" })

      expect(result).not_to include("<")
      expect(result).not_to include(">")
      expect(result).to include("u003c") # `<` is json_escaped to <
    end

    it "escapes single quotes so the JSON is safe inside a single-quoted JS string literal" do
      result = helper.escape_json({ "name" => "O'Brien" })

      # A raw ' would terminate the JSON.parse('...') literal; every ' must be backslash-escaped.
      expect(result).not_to match(/(?<!\\)'/)
    end

    it "handles a plain String argument without raising (the old `hash.class == 'String'` guard was dead code)" do
      expect { helper.escape_json("a string") }.not_to raise_error
      expect(helper.escape_json("a string")).to be_a(String)
    end

    it "handles Array and nil arguments" do
      expect(helper.escape_json([1, 2, 3])).to be_a(String)
      expect { helper.escape_json(nil) }.not_to raise_error
    end

    it "round-trips simple data through the JS-string + JSON.parse layers" do
      data = { "userId" => 42, "userName" => "alice", "admin" => true }
      result = helper.escape_json(data)

      # Undo the single-quoted-JS-literal layer escape_json adds (\\ -> \, \' -> '),
      # then JSON.parse exactly as the view does: JSON.parse('<result>').
      js_unescaped = result.gsub(/\\(['\\])/, '\1')
      expect(JSON.parse(js_unescaped)).to eq(data)
    end
  end
end
